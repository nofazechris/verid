import type { JsonValue } from "./canonical";
import { hashPolicy, hashResult, hashTask, executionKey, NO_POLICY, type PolicyDefinition, type TaskDefinition } from "./commitments";
import { EvidenceError, computeEvidenceRoot, type EvidenceCommitmentInput } from "./evidence";
import type { Hex32 } from "./hash";
import { computeReceiptHash, receiptSchema, type Receipt } from "./receipt";
import { hashValidationResult, type ValidationResult } from "./validation";

export type CheckStatus =
  | "VALID" //       recomputed locally and matches
  | "INVALID" //     recomputed/observed and does NOT match (or chain says reverted)
  | "NOT_CHECKED" // required input not supplied; nothing was verified
  | "UNAVAILABLE" // an external source was needed but could not be reached/answered
  | "PENDING" //     transaction submitted but not yet confirmed
  | "CONFIRMED" //   transaction confirmed on-chain
  | "MATCH"; //      on-chain record equals the receipt's commitments

export interface VerificationCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

/** What an Arc anchor looks like on-chain, as read back from the registry. */
export interface AnchorRecord {
  receiptHash: Hex32;
  taskHash: Hex32;
  policyHash: Hex32; // NO_POLICY (zero) when the execution had no policy
  evidenceRoot: Hex32;
  evidenceCount: number;
  resultHash: Hex32;
  validationStatus: "pass" | "fail" | "inconclusive";
  validationResultHash: Hex32;
}

export type TxStatus =
  | { status: "confirmed"; to?: string; blockNumber?: number }
  | { status: "pending" }
  | { status: "reverted" }
  | { status: "not_found" };

/**
 * Read-only chain access. Implemented by @verid/arc against a real Arc RPC;
 * injected here so core stays dependency-free and the verifier never has to
 * trust a VERID backend for chain facts. Methods MUST throw (not return a
 * guess) when the RPC is unreachable; the engine maps that to UNAVAILABLE.
 */
export interface ChainReader {
  chainId(): Promise<number>;
  registryAddress: string;
  getTransaction(hash: Hex32): Promise<TxStatus>;
  getAnchor(executionKey: Hex32): Promise<AnchorRecord | null>;
}

/** Optional underlying data. Each supplied item enables recomputation of its commitment. */
export interface VerificationBundle {
  task?: TaskDefinition;
  policy?: PolicyDefinition;
  evidence?: EvidenceCommitmentInput[];
  result?: JsonValue;
  validation?: ValidationResult;
}

export interface VerifyOptions {
  bundle?: VerificationBundle;
  chain?: ChainReader;
}

export type Outcome = "verified" | "incomplete" | "invalid";

export interface VerificationReport {
  receiptId?: string;
  executionId?: string;
  outcome: Outcome;
  checks: VerificationCheck[];
}

const OK: readonly CheckStatus[] = ["VALID", "CONFIRMED", "MATCH"];

const check = (id: string, label: string, status: CheckStatus, detail?: string): VerificationCheck => ({
  id,
  label,
  status,
  ...(detail ? { detail } : {}),
});

function recompute(
  id: string,
  label: string,
  supplied: boolean,
  missingDetail: string,
  fn: () => { ok: boolean; detail?: string },
): VerificationCheck {
  if (!supplied) return check(id, label, "NOT_CHECKED", missingDetail);
  try {
    const r = fn();
    return check(id, label, r.ok ? "VALID" : "INVALID", r.detail);
  } catch (e) {
    return check(id, label, "INVALID", e instanceof Error ? e.message : String(e));
  }
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Independently verify a receipt (PRD §12). Pure and deterministic given its
 * inputs; the only I/O is through the injected ChainReader.
 *
 * Honesty rules enforced here:
 *  - a check is only VALID if something was actually recomputed/compared;
 *  - missing inputs are NOT_CHECKED, never VALID;
 *  - an unreachable RPC is UNAVAILABLE, never INVALID or VALID;
 *  - the outcome is "verified" only when EVERY check is OK (so a receipt
 *    verified without evidence or chain access is reported "incomplete").
 */
export async function verifyReceipt(input: unknown, opts: VerifyOptions = {}): Promise<VerificationReport> {
  const checks: VerificationCheck[] = [];
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "$"}: ${i.message}`).join("; ");
    checks.push(check("schema", "Receipt schema", "INVALID", detail));
    for (const [id, label] of SKIPPED) checks.push(check(id, label, "NOT_CHECKED", "receipt schema invalid"));
    return finish(checks);
  }
  const r: Receipt = parsed.data;
  const bundle = opts.bundle ?? {};
  checks.push(check("schema", "Receipt schema", "VALID"));

  const expectedHash = computeReceiptHash(r);
  checks.push(
    check(
      "receipt_commitment",
      "Receipt commitment",
      eq(expectedHash, r.receiptHash) ? "VALID" : "INVALID",
      eq(expectedHash, r.receiptHash) ? undefined : `receiptHash does not match committed fields (expected ${expectedHash})`,
    ),
  );

  checks.push(
    recompute("task", "Task commitment", !!bundle.task, "task definition not supplied", () => {
      const h = hashTask(bundle.task!);
      return { ok: eq(h, r.task.hash), detail: eq(h, r.task.hash) ? undefined : `recomputed ${h}` };
    }),
  );

  if (r.policy) {
    checks.push(
      recompute("policy", "Policy commitment", !!bundle.policy, "policy definition not supplied", () => {
        const h = hashPolicy(bundle.policy!);
        return { ok: eq(h, r.policy!.hash), detail: eq(h, r.policy!.hash) ? undefined : `recomputed ${h}` };
      }),
    );
  }

  checks.push(
    recompute("evidence", "Evidence commitment", !!bundle.evidence, "evidence records not supplied", () => {
      let computed;
      try {
        computed = computeEvidenceRoot(bundle.evidence!);
      } catch (e) {
        if (e instanceof EvidenceError) return { ok: false, detail: e.message };
        throw e;
      }
      const foreign = bundle.evidence!.find((ev) => ev.executionId !== r.executionId);
      if (foreign) return { ok: false, detail: `evidence record belongs to execution ${foreign.executionId}` };
      if (computed.count !== r.evidence.count)
        return { ok: false, detail: `evidence count ${computed.count} != receipt count ${r.evidence.count}` };
      return eq(computed.root, r.evidence.root)
        ? { ok: true }
        : { ok: false, detail: `recomputed root ${computed.root}` };
    }),
  );

  checks.push(
    recompute("result", "Result commitment", bundle.result !== undefined, "result not supplied", () => {
      const h = hashResult(bundle.result as JsonValue);
      return { ok: eq(h, r.result.hash), detail: eq(h, r.result.hash) ? undefined : `recomputed ${h}` };
    }),
  );

  checks.push(
    recompute("validation", "Validator record", !!bundle.validation, "validation record not supplied", () => {
      const v = bundle.validation!;
      if (v.executionId !== r.executionId) return { ok: false, detail: "validation belongs to a different execution" };
      if (v.validatorId !== r.validation.validatorId || v.validatorVersion !== r.validation.validatorVersion)
        return { ok: false, detail: "validator id/version differs from receipt" };
      if (v.status !== r.validation.status) return { ok: false, detail: `status ${v.status} != receipt ${r.validation.status}` };
      const h = hashValidationResult(v);
      return eq(h, r.validation.resultHash) ? { ok: true } : { ok: false, detail: `recomputed ${h}` };
    }),
  );

  checks.push(...(await verifyAnchor(r, opts.chain)));
  return finish(checks);
}

const SKIPPED: [string, string][] = [
  ["receipt_commitment", "Receipt commitment"],
  ["task", "Task commitment"],
  ["evidence", "Evidence commitment"],
  ["result", "Result commitment"],
  ["validation", "Validator record"],
  ["arc_tx", "Arc transaction"],
  ["onchain", "Onchain commitments"],
];

async function verifyAnchor(r: Receipt, chain?: ChainReader): Promise<VerificationCheck[]> {
  const TX = "Arc transaction";
  const ON = "Onchain commitments";
  if (!r.anchor) {
    return [
      check("arc_tx", TX, "NOT_CHECKED", "receipt has no anchor"),
      check("onchain", ON, "NOT_CHECKED", "receipt has no anchor"),
    ];
  }
  if (!chain) {
    return [
      check("arc_tx", TX, "NOT_CHECKED", "no chain reader configured (offline)"),
      check("onchain", ON, "NOT_CHECKED", "no chain reader configured (offline)"),
    ];
  }
  const unavailable = (e: unknown) => {
    const d = `chain RPC unavailable: ${e instanceof Error ? e.message : String(e)}`;
    return [check("arc_tx", TX, "UNAVAILABLE", d), check("onchain", ON, "UNAVAILABLE", d)];
  };

  let chainId: number;
  try {
    chainId = await chain.chainId();
  } catch (e) {
    return unavailable(e);
  }
  if (chainId !== r.anchor.chainId) {
    const d = `receipt chainId ${r.anchor.chainId} != RPC chainId ${chainId}`;
    return [check("arc_tx", TX, "INVALID", d), check("onchain", ON, "NOT_CHECKED", "chain mismatch")];
  }
  if (!eq(chain.registryAddress, r.anchor.registryAddress)) {
    const d = `receipt registry ${r.anchor.registryAddress} != configured registry ${chain.registryAddress}`;
    return [check("arc_tx", TX, "INVALID", d), check("onchain", ON, "NOT_CHECKED", "registry mismatch")];
  }

  let tx: TxStatus;
  try {
    tx = await chain.getTransaction(r.anchor.transactionHash as Hex32);
  } catch (e) {
    return unavailable(e);
  }
  let txCheck: VerificationCheck;
  switch (tx.status) {
    case "confirmed":
      txCheck =
        tx.to && !eq(tx.to, r.anchor.registryAddress)
          ? check("arc_tx", TX, "INVALID", `transaction targets ${tx.to}, not the registry`)
          : check("arc_tx", TX, "CONFIRMED", tx.blockNumber !== undefined ? `block ${tx.blockNumber}` : undefined);
      break;
    case "pending":
      txCheck = check("arc_tx", TX, "PENDING", "transaction not yet confirmed");
      break;
    case "reverted":
      txCheck = check("arc_tx", TX, "INVALID", "transaction reverted");
      break;
    case "not_found":
      txCheck = check("arc_tx", TX, "INVALID", "transaction not found on this chain");
      break;
  }
  if (txCheck.status !== "CONFIRMED") {
    return [txCheck, check("onchain", ON, "NOT_CHECKED", "transaction not confirmed")];
  }

  let rec: AnchorRecord | null;
  try {
    rec = await chain.getAnchor(executionKey(r.executionId));
  } catch (e) {
    return [txCheck, check("onchain", ON, "UNAVAILABLE", `chain RPC unavailable: ${e instanceof Error ? e.message : String(e)}`)];
  }
  if (!rec) return [txCheck, check("onchain", ON, "INVALID", "no onchain record for this execution")];

  const diffs: string[] = [];
  const cmp = (name: string, a: string | number, b: string | number) => {
    if (String(a).toLowerCase() !== String(b).toLowerCase()) diffs.push(`${name}: receipt ${a} vs chain ${b}`);
  };
  cmp("receiptHash", r.receiptHash, rec.receiptHash);
  cmp("taskHash", r.task.hash, rec.taskHash);
  cmp("policyHash", r.policy?.hash ?? NO_POLICY, rec.policyHash);
  cmp("evidenceRoot", r.evidence.root, rec.evidenceRoot);
  cmp("evidenceCount", r.evidence.count, rec.evidenceCount);
  cmp("resultHash", r.result.hash, rec.resultHash);
  cmp("validationStatus", r.validation.status, rec.validationStatus);
  cmp("validationResultHash", r.validation.resultHash, rec.validationResultHash);
  return [
    txCheck,
    diffs.length ? check("onchain", ON, "INVALID", diffs.join("; ")) : check("onchain", ON, "MATCH"),
  ];
}

function finish(checks: VerificationCheck[]): VerificationReport {
  const outcome: Outcome = checks.some((c) => c.status === "INVALID")
    ? "invalid"
    : checks.every((c) => OK.includes(c.status))
    ? "verified"
    : "incomplete";
  return { outcome, checks };
}
