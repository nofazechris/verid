import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { readEscrow } from "../src";
import { WalletError, fundEscrow, hasWallet, parseUsdc, walletErrorMessage } from "../../../apps/web/lib/client/wallet";
import { deployEscrowStack, localChainAvailability, startLocalChain, type EscrowStack, type LocalChain } from "./anvil-harness";

// These tests start a real local EVM (anvil); allow for a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const avail = localChainAvailability();
if (!avail.ok) console.warn(`[arc wallet] SKIPPED — ${avail.reason}`);

/**
 * The dashboard funds an escrow through the standard EIP-1193 browser-wallet interface (window.ethereum). No extension
 * can be clicked in CI, so this is a provider that behaves like one: it exposes one account, reports a chain, can
 * refuse like a user pressing "Reject", and forwards real transactions to a real local EVM that holds that account.
 */
function fakeWallet(rpc: string, account: Address, o: { chainId?: string; rejectSend?: boolean; rejectSwitch?: boolean } = {}) {
  const prompts: string[] = [];
  const provider = {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "eth_chainId") return o.chainId ?? "0x7a69"; // 31337
      if (method === "wallet_switchEthereumChain") {
        if (o.rejectSwitch) throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
        return null;
      }
      if (method === "eth_sendTransaction") {
        prompts.push("tx");
        if (o.rejectSend) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      }
      const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }) });
      const j = (await res.json()) as { result?: unknown; error?: { message: string; code: number } };
      if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
      return j.result;
    },
  };
  return { provider, prompts };
}

describe.skipIf(!avail.ok)("browser-wallet escrow funding (EIP-1193 provider against a real local EVM, NOT Arc)", () => {
  let lc: LocalChain;
  let st: EscrowStack;
  let n = 0;
  const key = () => `0x${(++n).toString(16).padStart(64, "0")}`;
  const params = () => ({ escrowAddress: st.escrow, tokenAddress: st.usdc, chainId: 31337, network: "local-anvil", executionKey: key() });
  const g = globalThis as unknown as { ethereum?: unknown };

  beforeAll(async () => {
    lc = await startLocalChain();
    st = await deployEscrowStack(lc);
  }, 90_000);
  afterAll(() => lc?.stop());
  beforeEach(() => {
    delete g.ethereum;
  });

  it("parseUsdc is strict: 6 decimals max, positive, no ambiguity", () => {
    expect(parseUsdc("25")).toBe(25_000_000n);
    expect(parseUsdc(" 12.5 ")).toBe(12_500_000n);
    expect(parseUsdc("0.000001")).toBe(1n);
    for (const bad of ["", "0", "0.0", "-1", "1.1234567", "abc", "1e6", "1,5", ".5", "99999999999999999999999999999999999999999"]) {
      expect(() => parseUsdc(bad), bad).toThrow(WalletError);
    }
  });

  it("with no wallet installed it says so plainly", async () => {
    expect(hasWallet()).toBe(false);
    await expect(fundEscrow(params(), { payee: st.payee, amount: "1", deadlineDays: 3 }, () => {})).rejects.toThrow(/No browser wallet/);
  });

  it("approves, then creates the escrow, and the CHAIN shows exactly what the user typed", async () => {
    const w = fakeWallet(lc.rpc, st.payer);
    g.ethereum = w.provider;
    expect(hasWallet()).toBe(true);
    const p = params();
    const steps: string[] = [];
    const before = Math.floor(Date.now() / 1000);
    const r = await fundEscrow(p, { payee: st.payee, amount: "12.5", deadlineDays: 3 }, (x) => steps.push(x));

    expect(r.payer.toLowerCase()).toBe(st.payer.toLowerCase());
    expect(steps.join(" | ")).toMatch(/Connecting.*approve.*1 of 2.*Create.*2 of 2/i);
    expect(w.prompts).toHaveLength(2); // exactly two wallet prompts: approve, create

    // The server reads the escrow from the chain by this id, so verify through the same reader it uses.
    const key = p.executionKey as `0x${string}`;
    const chain = (await import("viem")).createPublicClient({ transport: (await import("viem")).http(lc.rpc) });
    const e = await chain.readContract({ address: st.escrow, abi: (await import("../src")).escrowAbi, functionName: "getEscrow", args: [key] });
    expect(e.status).toBe(1); // Funded
    expect(e.amount).toBe(12_500_000n);
    expect(e.payee.toLowerCase()).toBe(st.payee.toLowerCase());
    expect(e.payer.toLowerCase()).toBe(st.payer.toLowerCase());
    expect(Number(e.deadline)).toBeGreaterThanOrEqual(before + 3 * 86_400 - 5);
    expect(Number(e.deadline)).toBeLessThanOrEqual(before + 3 * 86_400 + 120);
    void readEscrow; // (the arc reader is covered by settlement.test.ts)
  });

  it("a user who presses Reject gets a plain message and nothing moves", async () => {
    const w = fakeWallet(lc.rpc, st.payer, { rejectSend: true });
    g.ethereum = w.provider;
    const p = params();
    const err = await fundEscrow(p, { payee: st.payee, amount: "5", deadlineDays: 3 }, () => {}).catch((e) => e);
    expect(walletErrorMessage(err)).toBe("You declined the request in your wallet. Nothing was sent.");
    const { createPublicClient, http } = await import("viem");
    const e = await createPublicClient({ transport: http(lc.rpc) }).readContract({ address: st.escrow, abi: (await import("../src")).escrowAbi, functionName: "getEscrow", args: [p.executionKey as `0x${string}`] });
    expect(e.status).toBe(0); // no escrow
  });

  it("refuses up front when the wallet is on the wrong chain and cannot switch", async () => {
    g.ethereum = fakeWallet(lc.rpc, st.payer, { chainId: "0x1", rejectSwitch: true }).provider;
    const err = await fundEscrow(params(), { payee: st.payee, amount: "5", deadlineDays: 3 }, () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(WalletError);
    expect(err.message).toMatch(/Switch your wallet to local-anvil \(chain 31337\)/);
  });

  it("checks the balance before asking the user to sign anything", async () => {
    const w = fakeWallet(lc.rpc, st.payee); // the payee account holds no USDC
    g.ethereum = w.provider;
    const err = await fundEscrow(params(), { payee: st.payer, amount: "5", deadlineDays: 3 }, () => {}).catch((e) => e);
    expect(err.message).toMatch(/does not hold enough USDC/);
    expect(w.prompts).toHaveLength(0); // never prompted
  });

  it("rejects a bad payee or deadline before touching the wallet", async () => {
    const w = fakeWallet(lc.rpc, st.payer);
    g.ethereum = w.provider;
    await expect(fundEscrow(params(), { payee: "0x123", amount: "5", deadlineDays: 3 }, () => {})).rejects.toThrow(/valid 0x address/);
    await expect(fundEscrow(params(), { payee: st.payee, amount: "5", deadlineDays: 0 }, () => {})).rejects.toThrow(/between 1 and 365/);
    await expect(fundEscrow(params(), { payee: st.payee, amount: "5", deadlineDays: 400 }, () => {})).rejects.toThrow(/between 1 and 365/);
    expect(w.prompts).toHaveLength(0);
  });
});
