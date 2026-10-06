/**
 * Explicit execution lifecycle (PRD §6). Every transition must be backed by a
 * backend operation, validation record or confirmed onchain event — never by
 * a frontend click. This module only encodes *which* transitions are legal;
 * callers are responsible for the evidence that justifies each one.
 */
export const EXECUTION_STATES = [
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
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

const T: Record<ExecutionState, readonly ExecutionState[]> = {
  created: ["running", "failed"],
  running: ["evidence_captured", "failed"],
  evidence_captured: ["awaiting_validation", "failed"],
  awaiting_validation: ["validated", "validation_failed", "failed"],
  // A failed validation is preserved and terminal: retrying means a NEW execution.
  validation_failed: [],
  validated: ["anchoring", "failed"],
  // A reverted/dropped anchor transaction returns to `validated` so it can be
  // retried safely (anchoring is idempotent per execution key).
  anchoring: ["anchored", "validated", "failed"],
  anchored: ["settling"],
  // A failed settlement returns to `anchored` (refund path or retry).
  settling: ["settled", "anchored", "failed"],
  settled: [],
  failed: [],
};

export const TERMINAL_STATES: readonly ExecutionState[] = EXECUTION_STATES.filter(
  (s) => T[s].length === 0,
);

export class InvalidTransitionError extends Error {
  constructor(public readonly from: ExecutionState, public readonly to: ExecutionState) {
    super(`illegal execution transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: ExecutionState, to: ExecutionState): boolean {
  return T[from].includes(to);
}

export function assertTransition(from: ExecutionState, to: ExecutionState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function allowedTransitions(from: ExecutionState): readonly ExecutionState[] {
  return T[from];
}

/**
 * Settlement is only reachable from `anchored`, and `anchored` is only
 * reachable via `validated`. Failed validations can therefore never settle.
 */
export function canSettle(state: ExecutionState): boolean {
  return canTransition(state, "settling");
}
