import { describe, expect, it } from "vitest";
import {
  EXECUTION_STATES,
  InvalidTransitionError,
  TERMINAL_STATES,
  assertTransition,
  canSettle,
  canTransition,
  type ExecutionState,
} from "../src";

function walk(path: ExecutionState[]) {
  for (let i = 0; i < path.length - 1; i++) assertTransition(path[i]!, path[i + 1]!);
}

describe("execution state machine", () => {
  it("allows the documented success path", () => {
    walk(["created", "running", "evidence_captured", "awaiting_validation", "validated", "anchoring", "anchored"]);
    walk(["anchored", "settling", "settled"]);
  });

  it("allows the documented failed-validation path", () => {
    walk(["created", "running", "evidence_captured", "awaiting_validation", "validation_failed"]);
  });

  it("never allows skipping validation to anchor or settle", () => {
    expect(canTransition("awaiting_validation", "anchoring")).toBe(false);
    expect(canTransition("evidence_captured", "validated")).toBe(false);
    expect(canTransition("validated", "settling")).toBe(false);
    expect(canTransition("running", "anchored")).toBe(false);
  });

  it("failed validation is terminal and can never settle", () => {
    expect(TERMINAL_STATES).toContain("validation_failed");
    expect(canSettle("validation_failed")).toBe(false);
    for (const s of EXECUTION_STATES) expect(canTransition("validation_failed", s)).toBe(false);
  });

  it("only anchored executions can settle", () => {
    const settleable = EXECUTION_STATES.filter(canSettle);
    expect(settleable).toEqual(["anchored"]);
  });

  it("a reverted anchor can return to validated for a safe retry", () => {
    expect(canTransition("anchoring", "validated")).toBe(true);
  });

  it("throws a typed error on illegal transitions", () => {
    expect(() => assertTransition("settled", "created")).toThrow(InvalidTransitionError);
  });

  it("terminal states have no outgoing transitions", () => {
    for (const t of TERMINAL_STATES) for (const s of EXECUTION_STATES) expect(canTransition(t, s)).toBe(false);
  });
});
