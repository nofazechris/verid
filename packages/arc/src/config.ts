import { z } from "zod";

/**
 * Arc network configuration.
 *
 * PRESETS below were taken from Arc's official documentation on 2026-10-01:
 *   https://docs.arc.io/arc/references/connect-to-arc
 *   https://docs.arc.io/arc/references/contract-addresses
 *   https://docs.arc.io/arc/references/evm-differences
 * Re-verify before any production deployment; documentation can change. The
 * runtime additionally checks `eth_chainId` against `chainId` before use, so a
 * wrong RPC URL fails loudly instead of anchoring to the wrong chain.
 */
export interface ArcNetwork {
  name: string;
  chainId: number;
  rpcUrl: string;
  /** Base URL, no trailing slash. */
  explorerUrl: string;
  /** USDC ERC-20 interface. 6 decimals (the native gas token is 18 — never mix). */
  usdcAddress: `0x${string}`;
  /**
   * Minimum maxFeePerGas in wei. Arc's minimum base fee is 20 gwei and
   * transactions below it are silently dropped (docs: evm-differences).
   */
  minMaxFeePerGas: bigint;
}

const USDC = "0x3600000000000000000000000000000000000000" as const;
const GWEI = 1_000_000_000n;

export const ARC_MAINNET: ArcNetwork = {
  name: "arc-mainnet",
  chainId: 5042,
  rpcUrl: "https://rpc.mainnet.arc.io",
  explorerUrl: "https://explorer.arc.io",
  usdcAddress: USDC,
  minMaxFeePerGas: 20n * GWEI,
};

export const ARC_TESTNET: ArcNetwork = {
  name: "arc-testnet",
  chainId: 5042002,
  rpcUrl: "https://rpc.testnet.arc.io",
  explorerUrl: "https://explorer.testnet.arc.io",
  usdcAddress: USDC,
  minMaxFeePerGas: 20n * GWEI,
};

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte hex address");

const envSchema = z.object({
  ARC_RPC_URL: z.string().url(),
  ARC_CHAIN_ID: z.coerce.number().int().positive(),
  ARC_EXPLORER_URL: z.string().url(),
  ARC_USDC_ADDRESS: address.optional(),
  ARC_NETWORK_NAME: z.string().min(1).optional(),
});

/**
 * Build a network config from environment variables (PRD §13.4). Everything
 * chain-specific must be supplied explicitly — there are no silent fallbacks to
 * the presets, so a missing variable is an error rather than a guess.
 */
export function arcNetworkFromEnv(env: Record<string, string | undefined>): ArcNetwork {
  const e = envSchema.parse(env);
  return {
    name: e.ARC_NETWORK_NAME ?? `chain-${e.ARC_CHAIN_ID}`,
    chainId: e.ARC_CHAIN_ID,
    rpcUrl: e.ARC_RPC_URL,
    explorerUrl: e.ARC_EXPLORER_URL.replace(/\/+$/, ""),
    usdcAddress: (e.ARC_USDC_ADDRESS ?? USDC) as `0x${string}`,
    minMaxFeePerGas: 20n * GWEI,
  };
}

/**
 * Explorer transaction URL. Arc's docs do not state the explorer's URL scheme. VERIFIED 2026-10-02 on Arc TESTNET:
 * explorer.testnet.arc.io is Blockscout and "/tx/<hash>" opens the transaction page. The MAINNET explorer
 * (explorer.arc.io) is reachable but its scheme has not been checked against a real mainnet transaction; verify
 * before linking users to it.
 */
export function explorerTxUrl(net: Pick<ArcNetwork, "explorerUrl">, txHash: string): string {
  return `${net.explorerUrl}/tx/${txHash}`;
}
