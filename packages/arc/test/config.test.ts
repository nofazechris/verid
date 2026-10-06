import { describe, expect, it } from "vitest";
import { ARC_MAINNET, ARC_TESTNET, arcNetworkFromEnv, explorerTxUrl, trackTransaction, type TrackedStatus } from "../src";
import type { Hex32, TxStatus } from "@verid/core";

describe("network presets (from official Arc docs, 2026-10-01)", () => {
  it("mainnet", () => {
    expect(ARC_MAINNET).toMatchObject({
      chainId: 5042,
      rpcUrl: "https://rpc.mainnet.arc.io",
      explorerUrl: "https://explorer.arc.io",
      usdcAddress: "0x3600000000000000000000000000000000000000",
    });
  });
  it("testnet is a different chain", () => {
    expect(ARC_TESTNET.chainId).toBe(5042002);
    expect(ARC_TESTNET.chainId).not.toBe(ARC_MAINNET.chainId);
  });
  it("enforces Arc's 20 gwei minimum fee", () => {
    expect(ARC_MAINNET.minMaxFeePerGas).toBe(20_000_000_000n);
  });
});

describe("arcNetworkFromEnv", () => {
  const ok = { ARC_RPC_URL: "https://rpc.example", ARC_CHAIN_ID: "5042", ARC_EXPLORER_URL: "https://x.example/" };
  it("builds from explicit env and trims the trailing slash", () => {
    const n = arcNetworkFromEnv(ok);
    expect(n.chainId).toBe(5042);
    expect(n.explorerUrl).toBe("https://x.example");
  });
  it.each(["ARC_RPC_URL", "ARC_CHAIN_ID", "ARC_EXPLORER_URL"])("requires %s (no silent fallback to presets)", (k) => {
    const env: Record<string, string> = { ...ok };
    delete env[k];
    expect(() => arcNetworkFromEnv(env)).toThrow();
  });
  it("rejects malformed values", () => {
    expect(() => arcNetworkFromEnv({ ...ok, ARC_CHAIN_ID: "abc" })).toThrow();
    expect(() => arcNetworkFromEnv({ ...ok, ARC_RPC_URL: "not a url" })).toThrow();
    expect(() => arcNetworkFromEnv({ ...ok, ARC_USDC_ADDRESS: "0x123" })).toThrow();
  });
});

describe("explorerTxUrl", () => {
  it("joins base and hash", () => {
    expect(explorerTxUrl(ARC_MAINNET, "0xabc")).toBe("https://explorer.arc.io/tx/0xabc");
  });
});

describe("trackTransaction", () => {
  const H = `0x${"aa".repeat(32)}` as Hex32;
  const reader = (s: TxStatus) => ({ getTransaction: async () => s });
  const t = (s: TxStatus, ageMs: number): Promise<TrackedStatus> =>
    trackTransaction(reader(s), H, 1_000_000, { now: () => 1_000_000 + ageMs, droppedAfterMs: 120_000 });

  it("maps confirmed / reverted / pending directly", async () => {
    expect(await t({ status: "confirmed" }, 5)).toBe("confirmed");
    expect(await t({ status: "reverted" }, 5)).toBe("reverted");
    expect(await t({ status: "pending" }, 10 * 60_000)).toBe("pending");
  });
  it("unknown tx is pending while young, dropped once old (Arc drops under-priced txs silently)", async () => {
    expect(await t({ status: "not_found" }, 10_000)).toBe("pending");
    expect(await t({ status: "not_found" }, 300_000)).toBe("dropped");
  });
});
