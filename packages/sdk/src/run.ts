import type { Verid } from "./client.js";
import { uid } from "./client.js";
import { VeridError } from "./errors.js";
import type { Anchor, Check, EvidenceType, Json, Task, ValidationStatus, ValidatorDefinition } from "./types.js";

export interface RunOptions {
  /** An agent id (`agt_…`), or a slug (created on first use from the optional details). */
  agent: string | { slug: string; name?: string; version?: string; description?: string; capabilities?: string[] };
  task: Task;
  /**
   * What decides pass/fail: a validator id (`research-validator`, `custom:my-checker`, `custom:my-checker@2`),
   * or a definition with rules. A definition is kept in sync with your code: created the first time, reused while the
   * rules are unchanged, and given a new version when you change them (see `verid.validators.ensure`).
   */
  validator: string | ValidatorDefinition;
  /** Anchor a passing receipt on Arc. Default true. A server without a chain configured just skips it. */
  anchor?: boolean;
  /**
   * Makes the whole run idempotent: calling `run` again with the same id after a crash resumes the same execution
   * instead of creating a new one. Default: a fresh random id.
   */
  runId?: string;
  policyId?: string;
}

export interface RunContext {
  executionId: string;
  /** Record one piece of evidence. Do not record secrets. */
  record(type: Exclude<EvidenceType, "task">, content: Json | unknown): Promise<void>;
  /**
   * Run a tool call and record it: a `tool_call` before and a `tool_result` after (with the error, if it threw).
   * Returns what `fn` returned. This is how the evidence stays honest: it is written around the real call.
   */
  tool<I, O>(name: string, input: I, fn: (input: I) => Promise<O>): Promise<O>;
}

export interface RunOutcome<T> {
  /** What your function returned. */
  result: T;
  executionId: string;
  receiptId: string;
  /** The validator's verdict, decided on Verid's server. */
  status: ValidationStatus;
  validatorId: string;
  validatorVersion: string;
  checks: Check[];
  /** True only when the receipt is confirmed on-chain. */
  anchored: boolean;
  anchor: Anchor | null;
  /** Why anchoring did not happen (validation failed, no chain configured, still pending…). */
  anchorNote?: string;
  /** Dashboard page for this run. */
  executionUrl: string;
  /** Public, no-login proof page. Only meaningful to share when `anchored` is true. */
  proofUrl: string;
}

const MAX_EVIDENCE_BYTES = 200_000; // the server limit is 256 KB per record

/** Keep an oversized tool output recordable without losing the fact that it was truncated. */
function fit(content: unknown): unknown {
  let s: string;
  try {
    s = JSON.stringify(content) ?? "null";
  } catch {
    return { unserialisable: true, type: typeof content };
  }
  if (s.length <= MAX_EVIDENCE_BYTES) return content;
  return { truncated: true, originalBytes: s.length, preview: s.slice(0, 50_000) };
}

export class Run {
  constructor(private readonly verid: Verid, private readonly opts: RunOptions) {}

  async execute<T>(fn: (ctx: RunContext) => Promise<T>): Promise<RunOutcome<T>> {
    const v = this.verid;
    const o = this.opts;
    const runId = o.runId ?? uid();

    // 1. Resolve the agent and the validator (both are created on first use).
    const agentId = typeof o.agent === "string" && o.agent.startsWith("agt_") ? o.agent : (await v.agents.ensure(typeof o.agent === "string" ? { slug: o.agent } : o.agent)).id;
    const validatorId = typeof o.validator === "string" ? o.validator : await v.validators.ensure(o.validator);

    // 2. Open the execution. Every step below has a key derived from runId, so retrying is always safe.
    const execution = await v.executions.create({ agentId, task: o.task, ...(o.policyId ? { policyId: o.policyId } : {}) }, `${runId}:exec`);
    try {
      await v.executions.start(execution.id);
    } catch (e) {
      if (!(e instanceof VeridError) || e.code !== "invalid_state") throw e; // already started: we are resuming
    }
    await v.executions.addEvidence(execution.id, "task", o.task, `${runId}:task`);

    let n = 0;
    const record = async (type: Exclude<EvidenceType, "task">, content: unknown) => {
      await v.executions.addEvidence(execution.id, type, fit(content), `${runId}:ev:${n++}`);
    };
    const ctx: RunContext = {
      executionId: execution.id,
      record,
      async tool(name, input, f) {
        await record("tool_call", { tool: name, input });
        try {
          const output = await f(input);
          await record("tool_result", { tool: name, output });
          return output;
        } catch (e) {
          await record("tool_result", { tool: name, error: e instanceof Error ? e.message : String(e) }).catch(() => undefined);
          throw e;
        }
      },
    };

    // 3. Do the work. If it throws, say so (best effort) so monitoring shows a failed run, then rethrow.
    let result: T;
    try {
      result = await fn(ctx);
    } catch (e) {
      await v.executions.fail(execution.id, (e instanceof Error ? e.message : String(e)).slice(0, 500)).catch(() => undefined);
      throw e;
    }

    // 4. Result, validation (decided by the server), receipt.
    await v.executions.complete(execution.id, result as Json, `${runId}:complete`);
    const { validation } = await v.validations.run(execution.id, validatorId, `${runId}:validate`);
    const receipt = await v.receipts.create(execution.id);

    // 5. Anchor a passing receipt.
    let anchored = false;
    let anchor: Anchor | null = null;
    let anchorNote: string | undefined;
    if (validation.status !== "pass") {
      anchorNote = `validation ${validation.status}: a failed run is preserved but can never be anchored or paid out`;
    } else if (o.anchor === false) {
      anchorNote = "anchoring was turned off for this run";
    } else {
      try {
        const a = await v.receipts.anchor(receipt.receiptId);
        anchored = a.confirmed;
        anchor = a.anchor;
        if (!a.confirmed) anchorNote = a.pending ? "the anchor transaction is pending; call verid.receipts.anchor(receiptId) again to re-check" : "not confirmed";
      } catch (e) {
        anchorNote = e instanceof VeridError && e.code === "unavailable" ? "this Verid server has no chain configured, or it is unreachable" : e instanceof Error ? e.message : String(e);
      }
    }

    return {
      result, executionId: execution.id, receiptId: receipt.receiptId, status: validation.status, validatorId: validation.validatorId,
      validatorVersion: validation.validatorVersion, checks: validation.checks, anchored, anchor, ...(anchorNote ? { anchorNote } : {}),
      executionUrl: v.executionUrl(execution.id), proofUrl: v.receipts.proofUrl(receipt.receiptId),
    };
  }
}
