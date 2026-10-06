import { z } from "zod";
import { DOMAIN, commit, isHex32, type Hex32 } from "./hash";

/**
 * Receipt format v1.0 (PRD §11).
 *
 * COMMITTED fields (bound by `receiptHash`, and what the registry contract
 * stores/emits): schemaVersion, executionId, agent, task.hash, policy.hash,
 * evidence.{root,count}, result.hash, validation.{status,validatorId,
 * validatorVersion,resultHash}.
 *
 * SUPPLEMENTARY fields (NOT committed; informational, verified only against
 * external sources where possible): receiptId, timestamps, anchor, settlement.
 * `anchor` cannot be committed because it is the output of anchoring the
 * commitment — including it would be circular.
 */
const hex32 = z.string().refine(isHex32, "must be 0x-prefixed lowercase 32-byte hex");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte hex address");
const isoTime = z.string().datetime({ offset: true });

export const VALIDATION_STATUSES = ["pass", "fail", "inconclusive"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export const receiptSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    receiptId: z.string().min(1),
    executionId: z.string().min(1),
    agent: z.object({ id: z.string().min(1), version: z.string().min(1) }).strict(),
    task: z.object({ hash: hex32 }).strict(),
    policy: z.object({ hash: hex32, id: z.string().min(1).optional() }).strict().optional(),
    evidence: z.object({ root: hex32, count: z.number().int().nonnegative() }).strict(),
    result: z.object({ hash: hex32 }).strict(),
    validation: z
      .object({
        status: z.enum(VALIDATION_STATUSES),
        validatorId: z.string().min(1),
        validatorVersion: z.string().min(1),
        resultHash: hex32,
      })
      .strict(),
    receiptHash: hex32,
    timestamps: z.object({ createdAt: isoTime, completedAt: isoTime.optional() }).strict().optional(),
    anchor: z
      .object({
        network: z.string().min(1),
        chainId: z.number().int().positive(),
        registryAddress: address,
        transactionHash: hex32,
        blockNumber: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    settlement: z
      .object({
        status: z.enum(["escrowed", "released", "refunded"]),
        amount: z.string().regex(/^\d+$/, "integer string in token base units"),
        tokenAddress: address,
        transactionHash: hex32.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Receipt = z.infer<typeof receiptSchema>;

/** The exact object hashed into `receiptHash`. Key order is irrelevant (canonicalized). */
export function committedFields(r: Omit<Receipt, "receiptHash"> | Receipt) {
  return {
    schemaVersion: r.schemaVersion,
    executionId: r.executionId,
    agent: { id: r.agent.id, version: r.agent.version },
    task: { hash: r.task.hash },
    // Absent policy and a present policy are distinct commitments.
    policy: r.policy ? { hash: r.policy.hash } : null,
    evidence: { root: r.evidence.root, count: r.evidence.count },
    result: { hash: r.result.hash },
    validation: {
      status: r.validation.status,
      validatorId: r.validation.validatorId,
      validatorVersion: r.validation.validatorVersion,
      resultHash: r.validation.resultHash,
    },
  };
}

export function computeReceiptHash(r: Omit<Receipt, "receiptHash"> | Receipt): Hex32 {
  return commit(DOMAIN.receipt, committedFields(r));
}

export type ReceiptInput = Omit<Receipt, "receiptHash" | "schemaVersion" | "anchor" | "settlement"> & {
  schemaVersion?: "1.0";
};

/** Build a receipt, computing and attaching `receiptHash`. Validates the result. */
export function buildReceipt(input: ReceiptInput): Receipt {
  const base = { ...input, schemaVersion: "1.0" as const };
  const receipt = { ...base, receiptHash: computeReceiptHash(base as Omit<Receipt, "receiptHash">) };
  return receiptSchema.parse(receipt);
}
