import {
  assertTransition,
  buildReceipt,
  computeEvidenceRoot,
  hashEvidenceContent,
  hashPolicy,
  hashResult,
  hashTask,
  hashValidationResult,
  type EvidenceCommitmentInput,
  type EvidenceType,
  type ExecutionState,
  type JsonValue,
  type PolicyDefinition,
  type Receipt,
  type TaskDefinition,
  type ValidationResult,
  type VerificationBundle,
} from "@verid/core";
import { validateResearch } from "@verid/validators";
import { COMPLETE_RESULTS, FIXTURE_NOTICE, INCOMPLETE_RESULTS, type StartupRecord } from "./fixture";

export const TASK: TaskDefinition = {
  description: "Find 10 AI startups in Nigeria founded after 2024 and return their names, websites, founding years, and source URLs.",
  parameters: { foundedAfter: 2024, minimumResults: 10 },
  outputSchema: { type: "array", items: ["name", "website", "foundedYear", "sources"] as unknown as JsonValue },
};

export const POLICY: PolicyDefinition = {
  id: "research-policy",
  version: 1,
  rules: { allowedTools: ["search", "http.fetch"], maxRecords: 20, requiredOutputFields: ["name", "website", "foundedYear", "sources"] },
};

export type Scenario = "success" | "incomplete";

/** Identifies the chain/registry a receipt's `anchor` block refers to. */
export interface AnchorTarget {
  network: string;
  chainId: number;
  registryAddress: string;
}

export type AnchorFn = (receipt: Receipt) => Promise<
  | { status: "confirmed"; txHash: `0x${string}`; blockNumber?: number }
  | { status: "pending"; txHash: `0x${string}` }
  | { status: "reverted"; txHash: `0x${string}` }
>;

export interface ExecutionRun {
  executionId: string;
  /** Every state the execution passed through, in order. */
  states: ExecutionState[];
  receipt: Receipt;
  bundle: VerificationBundle;
  validation: ValidationResult;
  /** Off-chain evidence payloads (NEVER published on-chain). */
  evidencePayloads: Record<number, JsonValue>;
}

/**
 * Runs one ResearchBot execution through the explicit lifecycle. Every state
 * change goes through `assertTransition`; an execution is only `validated` when
 * the validator actually returned `pass`, and only anchored when the anchor
 * function reports a confirmed transaction.
 */
export async function runExecution(opts: {
  executionId: string;
  scenario: Scenario;
  /** Where/how to anchor. Omit to run the lifecycle without anchoring. */
  anchor?: { target: AnchorTarget; submit: AnchorFn };
  now?: () => Date;
}): Promise<ExecutionRun> {
  const { executionId, scenario } = opts;
  const now = opts.now ?? (() => new Date());
  const states: ExecutionState[] = [];
  const current = (): ExecutionState | undefined => states[states.length - 1];
  const go = (next: ExecutionState) => {
    const from = current();
    if (from !== undefined) assertTransition(from, next);
    states.push(next);
  };

  go("created");
  const createdAt = now().toISOString();
  go("running");

  // ---- the "agent": a deterministic fixture standing in for live research ----
  const results: StartupRecord[] = scenario === "success" ? COMPLETE_RESULTS : INCOMPLETE_RESULTS;
  const payloads: Record<number, JsonValue> = {
    0: { kind: "task", task: TASK as unknown as JsonValue },
    1: { kind: "tool_call", tool: "search", query: "AI startups in Nigeria founded after 2024", fixture: true },
    2: { kind: "tool_result", tool: "search", fixture: true, notice: FIXTURE_NOTICE, results: results as unknown as JsonValue },
    3: { kind: "result", results: results as unknown as JsonValue },
  };
  const types: EvidenceType[] = ["task", "tool_call", "tool_result", "result"];

  const evidence: EvidenceCommitmentInput[] = types.map((type, sequenceNumber) => ({
    executionId,
    sequenceNumber,
    type,
    timestamp: now().toISOString(),
    contentHash: hashEvidenceContent(payloads[sequenceNumber]!),
  }));
  const { root, count } = computeEvidenceRoot(evidence);
  go("evidence_captured");
  go("awaiting_validation");

  // ---- validation (deterministic; real result, not an animation) ----
  const validation = validateResearch(
    { executionId, result: results, evidence, validatedAt: now().toISOString() },
    { minimumResults: 10, foundedAfter: 2024 },
  );
  // Only a real PASS can move to `validated`; anything else is a preserved, terminal failure.
  go(validation.status === "pass" ? "validated" : "validation_failed");

  let receipt = buildReceipt({
    receiptId: `receipt_${executionId}`,
    executionId,
    agent: { id: "researchbot", version: "1.0.0" },
    task: { hash: hashTask(TASK) },
    policy: { id: POLICY.id, hash: hashPolicy(POLICY) },
    evidence: { root, count },
    result: { hash: hashResult(results as unknown as JsonValue) },
    validation: {
      status: validation.status,
      validatorId: validation.validatorId,
      validatorVersion: validation.validatorVersion,
      resultHash: hashValidationResult(validation),
    },
    timestamps: { createdAt, completedAt: now().toISOString() },
  });

  if (current() === "validated" && opts.anchor) {
    go("anchoring");
    const out = await opts.anchor.submit(receipt);
    if (out.status === "confirmed") {
      go("anchored");
      receipt = {
        ...receipt,
        anchor: { ...opts.anchor.target, transactionHash: out.txHash, blockNumber: out.blockNumber },
      };
    } else if (out.status === "reverted") {
      go("validated"); // safe to retry: anchoring is idempotent
    } // pending: remains `anchoring`; the caller persists the hash and polls
  }

  return {
    executionId, states, receipt, validation, evidencePayloads: payloads,
    bundle: { task: TASK, policy: POLICY, evidence, result: results as unknown as JsonValue, validation },
  };
}
