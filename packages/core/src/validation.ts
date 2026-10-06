import type { JsonValue } from "./canonical";
import { DOMAIN, commit, type Hex32 } from "./hash";
import type { ValidationStatus } from "./receipt";

export interface CheckResult {
  /** Stable machine id, e.g. "min_entries". */
  id: string;
  description: string;
  ok: boolean;
  /**
   * Whether the check was objectively evaluated against the recorded data.
   * `false` means the validator could not determine the outcome (-> inconclusive).
   */
  determinate: boolean;
  /** Explanation, always present on failure. */
  explanation?: string;
  details?: JsonValue;
}

/** A validator's complete, hashable output (PRD §10.4). */
export interface ValidationResult {
  validatorId: string;
  validatorVersion: string;
  executionId: string;
  status: ValidationStatus;
  checks: CheckResult[];
  /** Sequence numbers of the evidence records the validator relied on. */
  evidenceRefs: number[];
  /** ISO-8601. */
  validatedAt: string;
}

export function hashValidationResult(result: ValidationResult): Hex32 {
  return commit(DOMAIN.validation, result as unknown as JsonValue);
}
