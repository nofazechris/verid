import type { ChainReader, Hex32, Receipt } from "@verid/core";
import type { Db } from "./db/client";
import { ApiError } from "./errors";
import type { Mailer } from "./mailer";
import type { RateLimiter } from "./rate-limit";

export type Role = "owner" | "admin" | "developer" | "viewer";
const RANK: Record<Role, number> = { viewer: 0, developer: 1, admin: 2, owner: 3 };

/** The authenticated caller, ALWAYS scoped to exactly one workspace. */
export interface Principal {
  kind: "user" | "api_key";
  /** user id or api key id */
  id: string;
  userId?: string;
  workspaceId: string;
  role: Role;
}

export function requireRole(p: Principal, min: Role): void {
  if (RANK[p.role] < RANK[min]) {
    throw new ApiError("forbidden", `this action requires the '${min}' role or higher`);
  }
}

export interface AnchorTarget {
  network: string;
  chainId: number;
  registryAddress: string;
}

export type AnchorSubmitResult =
  | { status: "confirmed"; txHash: Hex32; blockNumber?: number }
  | { status: "pending"; txHash: Hex32 }
  | { status: "reverted"; txHash: Hex32 };

/** Sends a receipt's commitments to the chain. Implemented by @verid/arc wiring; faked in tests. */
export interface Anchorer {
  target: AnchorTarget;
  submit(receipt: Receipt): Promise<AnchorSubmitResult>;
}

export type TxResult =
  | { status: "confirmed"; txHash?: Hex32; blockNumber?: number }
  | { status: "pending"; txHash: Hex32 }
  | { status: "reverted"; txHash: Hex32 };

/** Writes a validation outcome to the on-chain VeridValidation contract (signed by a registered validator key). */
export interface ValidationRecorder {
  target: { validationAddress: string };
  record(input: { executionId: string; status: "pass" | "fail" | "inconclusive"; resultHash: Hex32; validatorVersion: string }): Promise<TxResult>;
}

export interface OnchainEscrow {
  status: "none" | "funded" | "released" | "refunded";
  payer: string;
  payee: string;
  /** Token base units (USDC ERC-20 interface: 6 decimals), decimal string. */
  amount: string;
  /** Unix seconds. */
  deadline: number;
}

/**
 * Reads and settles VeridEscrow. `canRelease`/`canRefund` are decided by the CONTRACT (never by this server),
 * and release/refund are permissionless, so the relayer only pays gas; it can only ever move funds to the
 * payee (after validation Pass + anchor) or back to the payer.
 */
export interface EscrowGateway {
  target: { escrowAddress: string; chainId: number; network: string };
  token(): Promise<string>;
  read(executionId: string): Promise<OnchainEscrow>;
  canRelease(executionId: string): Promise<boolean>;
  canRefund(executionId: string): Promise<boolean>;
  release(executionId: string): Promise<TxResult>;
  refund(executionId: string): Promise<TxResult>;
}

export interface ChainStatus {
  chainId: number;
  blockNumber: number;
}

/** Cookie-session identity. `sessionVersion` is compared to the user's current one so password resets revoke old sessions. */
export interface SessionIdentity {
  userId: string;
  sessionVersion?: number;
}
export type SessionResolver = (req: Request) => Promise<SessionIdentity | null>;

/** A signed-in user, before any workspace is chosen (used by /me and workspace creation). */
export interface UserPrincipal {
  userId: string;
  email: string;
  emailVerified: boolean;
}

export interface Deps {
  db: Db;
  now: () => Date;
  limiter: RateLimiter;
  /** Browser origins allowed to make cookie-authenticated mutating requests (CSRF defense). */
  allowedOrigins: string[];
  /** Cookie-session resolution (Auth.js in the web app). API-key auth needs no resolver. */
  sessions?: SessionResolver;
  /** Outbound email (Resend in production, console in dev). */
  mailer: Mailer;
  /** Public base URL of the web app, used to build links in emails. e.g. https://app.verid.dev */
  appUrl: string;
  /** Require a verified email before a signed-in user may use workspace APIs. Default true. */
  requireVerifiedEmail?: boolean;
  /** scrypt cost (N). Production default 32768; tests use a small value for speed. */
  scryptN?: number;
  /** Dev only: exposes recent mail at GET /dev/outbox. Never set in production. */
  devOutbox?: () => unknown[];
  /** Chain access for anchoring and verification. Absent => anchoring reports `unavailable`. */
  anchorer?: Anchorer;
  /** Optional: record validation outcomes on-chain (needed before an escrow can release). */
  validationRecorder?: ValidationRecorder;
  /** Optional: USDC escrow settlement. Absent => settlement endpoints report `unavailable`. */
  escrow?: EscrowGateway;
  chain?: ChainReader;
  chainStatus?: () => Promise<ChainStatus>;
}

export interface Ctx {
  deps: Deps;
  principal: Principal;
}
