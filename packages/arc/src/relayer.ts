import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { executionKey, type ChainReader, type Hex32, type Receipt } from "@verid/core";
import { registryAbi } from "./abi";
import { anchorReceipt, type AnchorOutcome } from "./anchor";
import { ViemChainReader } from "./reader";
import { escrowAbi } from "./abi-settlement";
import { canRefund, canRelease, readEscrow, recordValidation, settleEscrow, type OnchainEscrow, type RecordValidationInput, type TxOutcome } from "./settlement";

export interface RelayerConfig {
  rpcUrl: string;
  chainId: number;
  /** Human label stored in receipts' anchor block, e.g. "arc-mainnet". */
  networkName: string;
  registryAddress: Address;
  /** Secret. Read from the environment by the caller; never logged or returned. */
  privateKey: Hex;
  /** Minimum maxFeePerGas in wei (Arc: 20 gwei). */
  minMaxFeePerGas: bigint;
  confirmationTimeoutMs?: number;
  /**
   * Optional: on-chain validation records. `validatorPrivateKey` MUST be a key registered on VeridValidation
   * and SHOULD differ from `privateKey` (the anchorer), so the two roles can be revoked independently.
   */
  validationAddress?: Address;
  validatorPrivateKey?: Hex;
  /** Optional: VeridEscrow. Release/refund are permissionless, so the relayer key only pays gas for them. */
  escrowAddress?: Address;
}

export type RelayerSubmitResult =
  | { status: "confirmed"; txHash: Hex32; blockNumber?: number }
  | { status: "pending"; txHash: Hex32 }
  | { status: "reverted"; txHash: Hex32 };

export interface Relayer {
  /** Structurally compatible with @verid/server's `Anchorer`. */
  anchorer: {
    target: { network: string; chainId: number; registryAddress: string };
    submit(receipt: Receipt): Promise<RelayerSubmitResult>;
  };
  reader: ChainReader;
  /** Present when `validationAddress` + `validatorPrivateKey` are configured. */
  validationRecorder?: {
    target: { validationAddress: string };
    /** The validator's public address (what must be registered on VeridValidation). */
    address: Address;
    record(input: RecordValidationInput): Promise<TxOutcome>;
  };
  /** Present when `escrowAddress` is configured. */
  escrow?: {
    target: { escrowAddress: string; chainId: number; network: string };
    /** The ERC-20 the escrow holds (immutable on the contract). */
    token(): Promise<string>;
    read(executionId: string): Promise<OnchainEscrow>;
    canRelease(executionId: string): Promise<boolean>;
    canRefund(executionId: string): Promise<boolean>;
    release(executionId: string): Promise<TxOutcome>;
    refund(executionId: string): Promise<TxOutcome>;
  };
  status(): Promise<{ chainId: number; blockNumber: number }>;
  /** The relayer's public address (safe to display; this is what must be allowlisted on the registry). */
  address: Address;
}

/**
 * Build the production chain runtime from configuration. The private key is only
 * used to construct a local signer; it is not retained anywhere else, not logged,
 * and not exposed on the returned object.
 */
export function createRelayer(cfg: RelayerConfig): Relayer {
  const chain = defineChain({
    id: cfg.chainId,
    name: cfg.networkName,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const transport = http(cfg.rpcUrl, { timeout: 15_000, retryCount: 2 });
  const publicClient = createPublicClient({ chain, transport });
  const account = privateKeyToAccount(cfg.privateKey);
  const walletClient = createWalletClient({ chain, account, transport });
  const reader = new ViemChainReader(publicClient, cfg.registryAddress);

  const network = { chainId: cfg.chainId, minMaxFeePerGas: cfg.minMaxFeePerGas };
  const timeout = cfg.confirmationTimeoutMs;

  let validationRecorder: Relayer["validationRecorder"];
  if (cfg.validationAddress && cfg.validatorPrivateKey) {
    const vAccount = privateKeyToAccount(cfg.validatorPrivateKey);
    const vWallet = createWalletClient({ chain, account: vAccount, transport });
    const validationAddress = cfg.validationAddress;
    validationRecorder = {
      target: { validationAddress },
      address: vAccount.address,
      record: (input) => recordValidation({ publicClient, walletClient: vWallet, validationAddress, input, network, confirmationTimeoutMs: timeout }),
    };
  }

  let escrow: Relayer["escrow"];
  if (cfg.escrowAddress) {
    const escrowAddress = cfg.escrowAddress;
    let token: string | undefined;
    escrow = {
      target: { escrowAddress, chainId: cfg.chainId, network: cfg.networkName },
      async token() {
        token ??= await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "token" });
        return token;
      },
      read: (executionId) => readEscrow(publicClient, escrowAddress, executionId),
      canRelease: (id) => canRelease(publicClient, escrowAddress, id),
      canRefund: (id) => canRefund(publicClient, escrowAddress, id, account.address),
      release: (id) => settleEscrow({ publicClient, walletClient, escrowAddress, executionId: id, action: "release", network, confirmationTimeoutMs: timeout }),
      refund: (id) => settleEscrow({ publicClient, walletClient, escrowAddress, executionId: id, action: "refund", network, confirmationTimeoutMs: timeout }),
    };
  }

  return {
    address: account.address,
    reader,
    validationRecorder,
    escrow,
    status: async () => ({ chainId: await publicClient.getChainId(), blockNumber: Number(await publicClient.getBlockNumber()) }),
    anchorer: {
      target: { network: cfg.networkName, chainId: cfg.chainId, registryAddress: cfg.registryAddress },
      async submit(receipt) {
        const out: AnchorOutcome = await anchorReceipt({
          publicClient,
          walletClient,
          registryAddress: cfg.registryAddress,
          receipt,
          network: { chainId: cfg.chainId, minMaxFeePerGas: cfg.minMaxFeePerGas },
          confirmationTimeoutMs: cfg.confirmationTimeoutMs,
        });
        if (out.status === "confirmed") {
          if (out.txHash) return { status: "confirmed", txHash: out.txHash, blockNumber: out.blockNumber };
          // Already anchored by an earlier attempt whose tx hash we did not keep: look it up from the event log.
          const hash = await findAnchorTx(publicClient, cfg.registryAddress, receipt);
          if (!hash) throw new Error("registry already holds this anchor but its transaction could not be located");
          return { status: "confirmed", txHash: hash.txHash, blockNumber: hash.blockNumber };
        }
        return { status: out.status, txHash: out.txHash };
      },
    },
  };
}

async function findAnchorTx(
  client: ReturnType<typeof createPublicClient>,
  registry: Address,
  receipt: Receipt,
): Promise<{ txHash: Hex32; blockNumber: number } | null> {
  const logs = await client.getContractEvents({
    address: registry,
    abi: registryAbi,
    eventName: "ExecutionAnchored",
    args: { executionKey: executionKey(receipt.executionId) },
    fromBlock: 0n,
  });
  const l = logs[0];
  return l?.transactionHash ? { txHash: l.transactionHash, blockNumber: Number(l.blockNumber) } : null;
}
