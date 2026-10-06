import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * VERID Postgres schema (PRD §18).
 *
 * Conventions:
 *  - IDs are opaque, unpredictable strings (see ids.ts) so records are never
 *    enumerable across workspaces.
 *  - EVERY protected table carries `workspace_id`; services always filter on it.
 *  - Hashes are stored as 0x-prefixed lowercase hex text.
 *  - Raw evidence/result content lives only here (off-chain), never on-chain.
 */

export const roleEnum = pgEnum("workspace_role", ["owner", "admin", "developer", "viewer"]);
export const agentStatusEnum = pgEnum("agent_status", ["active", "inactive"]);
export const executionStatusEnum = pgEnum("execution_status", [
  "created",
  "running",
  "evidence_captured",
  "awaiting_validation",
  "validated",
  "validation_failed",
  "anchoring",
  "anchored",
  "settling",
  "settled",
  "failed",
]);
export const evidenceTypeEnum = pgEnum("evidence_type", [
  "task",
  "tool_call",
  "tool_result",
  "model_output",
  "artifact",
  "result",
  "validation",
]);
export const validationStatusEnum = pgEnum("validation_status", ["pass", "fail", "inconclusive"]);
export const anchorStatusEnum = pgEnum("anchor_status", ["submitted", "confirmed", "reverted", "dropped"]);
export const settlementStatusEnum = pgEnum("settlement_status", ["escrowed", "released", "refunded", "failed"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(), // stored lowercased
    name: text("name"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /** scrypt hash (see password.ts). Null for accounts that only use an OAuth provider. */
    passwordHash: text("password_hash"),
    /** Bumped on password reset so every previously issued session stops working. */
    sessionVersion: integer("session_version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const authTokenPurposeEnum = pgEnum("auth_token_purpose", ["verify_email", "reset_password"]);

/** Single-use, expiring tokens for email verification and password reset. Only a hash is stored. */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: authTokenPurposeEnum("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("auth_tokens_hash_uq").on(t.tokenHash), index("auth_tokens_user_idx").on(t.userId, t.purpose)],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("workspaces_slug_uq").on(t.slug)],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("workspace_members_uq").on(t.workspaceId, t.userId), index("workspace_members_user_idx").on(t.userId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Public, non-secret lookup prefix (also shown in the UI). */
    keyPrefix: text("key_prefix").notNull(),
    /** sha256 of the secret part. The secret itself is never stored. */
    keyHash: text("key_hash").notNull(),
    /** API keys are limited to these roles (never admin/owner). */
    role: roleEnum("role").notNull().default("developer"),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_keys_prefix_uq").on(t.keyPrefix), index("api_keys_workspace_idx").on(t.workspaceId)],
);

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Stable, workspace-unique handle, e.g. "researchbot". */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    version: text("version").notNull(),
    capabilities: jsonb("capabilities").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Optional reference to an external identity (e.g. ERC-8004). NOT verified by VERID. */
    identityReference: text("identity_reference"),
    status: agentStatusEnum("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("agents_ws_slug_uq").on(t.workspaceId, t.slug)],
);

export const policies = pgTable(
  "policies",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** Immutable once created. Changing a policy creates a NEW version row. */
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    policyHash: text("policy_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("policies_ws_slug_version_uq").on(t.workspaceId, t.slug, t.version)],
);

/**
 * Workspace-defined, rule-based validators (see @verid/validators `RuleDefinition`). Like policies they are
 * IMMUTABLE once created: editing creates version N+1, and every validation records exactly which version (and
 * rules hash) produced it.
 */
export const customValidators = pgTable(
  "custom_validators",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<{ rules: unknown[] }>().notNull(),
    definitionHash: text("definition_hash").notNull(),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("custom_validators_ws_slug_version_uq").on(t.workspaceId, t.slug, t.version)],
);

export const executions = pgTable(
  "executions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    policyId: text("policy_id").references(() => policies.id),
    taskDefinition: jsonb("task_definition").$type<Record<string, unknown>>().notNull(),
    taskHash: text("task_hash").notNull(),
    status: executionStatusEnum("status").notNull().default("created"),
    /** Raw result: private, off-chain only. */
    result: jsonb("result"),
    resultHash: text("result_hash"),
    evidenceRoot: text("evidence_root"),
    evidenceCount: integer("evidence_count"),
    error: jsonb("error").$type<{ code: string; message: string }>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("executions_ws_created_idx").on(t.workspaceId, t.createdAt),
    index("executions_ws_status_idx").on(t.workspaceId, t.status),
    index("executions_agent_idx").on(t.agentId),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id, { onDelete: "cascade" }),
    sequenceNumber: integer("sequence_number").notNull(),
    type: evidenceTypeEnum("type").notNull(),
    /** Raw content: private, off-chain only. */
    content: jsonb("content"),
    contentHash: text("content_hash").notNull(),
    contentReference: text("content_reference"),
    /** NOT committed in the evidence root. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    /** The timestamp that is COMMITTED into the evidence leaf (ISO string, ms precision). */
    evidenceTimestamp: text("evidence_timestamp").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("evidence_exec_seq_uq").on(t.executionId, t.sequenceNumber), index("evidence_ws_idx").on(t.workspaceId)],
);

export const validations = pgTable(
  "validations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** One validation per execution: a failed validation is terminal and preserved. */
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id, { onDelete: "cascade" }),
    validatorId: text("validator_id").notNull(),
    validatorVersion: text("validator_version").notNull(),
    status: validationStatusEnum("status").notNull(),
    checks: jsonb("checks").notNull(),
    /** The complete ValidationResult that `resultHash` commits to. */
    result: jsonb("result").notNull(),
    resultHash: text("result_hash").notNull(),
    validatedAt: timestamp("validated_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("validations_exec_uq").on(t.executionId)],
);

export const receipts = pgTable(
  "receipts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id, { onDelete: "cascade" }),
    schemaVersion: text("schema_version").notNull(),
    /** Immutable. The anchor block is merged at read time from arc_anchors. */
    receiptData: jsonb("receipt_data").notNull(),
    receiptHash: text("receipt_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("receipts_exec_uq").on(t.executionId), index("receipts_ws_created_idx").on(t.workspaceId, t.createdAt)],
);

export const arcAnchors = pgTable(
  "arc_anchors",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id, { onDelete: "cascade" }),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    network: text("network").notNull(),
    chainId: bigint("chain_id", { mode: "number" }).notNull(),
    contractAddress: text("contract_address").notNull(),
    transactionHash: text("transaction_hash"),
    blockNumber: bigint("block_number", { mode: "number" }),
    status: anchorStatusEnum("status").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("arc_anchors_exec_idx").on(t.executionId), index("arc_anchors_ws_idx").on(t.workspaceId)],
);

export const settlements = pgTable(
  "settlements",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id, { onDelete: "cascade" }),
    requesterAddress: text("requester_address").notNull(),
    recipientAddress: text("recipient_address").notNull(),
    /** Integer string in token base units (USDC ERC-20 interface = 6 decimals). */
    amount: text("amount").notNull(),
    tokenAddress: text("token_address").notNull(),
    /** The VeridEscrow contract and chain this settlement lives on. */
    escrowAddress: text("escrow_address").notNull(),
    chainId: bigint("chain_id", { mode: "number" }).notNull(),
    /** Unix seconds; after this the payer can recover funds that were never validated + anchored. */
    deadline: bigint("deadline", { mode: "number" }).notNull(),
    status: settlementStatusEnum("status").notNull(),
    depositTxHash: text("deposit_tx_hash"),
    releaseTxHash: text("release_tx_hash"),
    refundTxHash: text("refund_tx_hash"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("settlements_exec_unique").on(t.executionId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(), // "user" | "api_key" | "system"
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** Never contains secrets or raw private data. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_ws_created_idx").on(t.workspaceId, t.createdAt)],
);

/** Replay protection for retryable operations (PRD §6.4). */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    /** METHOD + path, so one key cannot be reused across different operations. */
    operation: text("operation").notNull(),
    /** sha256 of the request body: the same key with a different body is a conflict. */
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.key, t.operation] })],
);
