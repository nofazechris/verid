import { describe, expect, it } from "vitest";
import type { EvidenceCommitmentInput } from "@verid/core";
import { parsePath, parseRuleDefinition, runRules, type RuleDefinition } from "../src";

const ev = (types: string[]): EvidenceCommitmentInput[] =>
  types.map((type, i) => ({ executionId: "e1", sequenceNumber: i, type: type as never, timestamp: "2026-10-01T00:00:00.000Z", contentHash: `0x${"11".repeat(32)}` as never }));

const run = (def: RuleDefinition, result: unknown, o: { evidence?: EvidenceCommitmentInput[]; params?: Record<string, unknown> } = {}) =>
  runRules(def, { executionId: "e1", validatorId: "custom:t", validatorVersion: "1+abc", result, evidence: o.evidence, taskParameters: o.params, validatedAt: "2026-10-01T00:00:00.000Z" });
const parse = (x: unknown) => {
  const r = parseRuleDefinition(x);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value;
};

const people = [{ name: "A", email: "a@x.io", age: 30 }, { name: "B", email: "b@x.io", age: 41 }];

describe("parseRuleDefinition", () => {
  it("accepts a valid definition and rejects malformed ones with precise messages", () => {
    expect(parseRuleDefinition({ rules: [{ type: "items", path: "$", min: 1 }] }).ok).toBe(true);
    const bad = (x: unknown) => { const r = parseRuleDefinition(x); return r.ok ? [] : r.errors; };
    expect(bad(null)[0]).toMatch(/rules/);
    expect(bad({ rules: [] })).toContain("add at least one rule");
    expect(bad({ rules: [{ type: "nope" }] })[0]).toMatch(/unknown type/);
    expect(bad({ rules: [{ type: "items", path: "$" }] })[0]).toMatch(/min and\/or max/);
    expect(bad({ rules: [{ type: "items", path: "name", min: 1 }] })[0]).toMatch(/path must look like/);
    expect(bad({ rules: [{ type: "items", path: "$", min: 1, mni: 3 }] })[0]).toMatch(/unknown key/); // typo never weakens a rule
    expect(bad({ rules: [{ type: "items", path: "$", min: 1 }], extra: 1 })[0]).toMatch(/top level/);
    expect(bad({ rules: [{ type: "field_format", path: "$[*].x", format: "phone" }] })[0]).toMatch(/format must be one of/);
    expect(bad({ rules: [{ type: "evidence", types: ["magic"] }] })[0]).toMatch(/types must be/);
    expect(bad({ rules: Array(51).fill({ type: "unique", path: "$" }) })[0]).toMatch(/at most 50/);
  });
  it("parses paths strictly", () => {
    expect(parsePath("$")).toEqual([]);
    expect(parsePath("$.a[*].b[0]")).toHaveLength(4);
    for (const p of ["a", "$..a", "$.a b", "$[*", "$.a;drop", "$[-1]"]) expect(parsePath(p)).toBeNull();
  });
});

describe("runRules", () => {
  it("passes when every rule holds, and always carries the two honesty checks", () => {
    const def = parse({ rules: [
      { type: "items", path: "$", min: 2 },
      { type: "required_fields", path: "$[*]", fields: ["name", "email"] },
      { type: "field_format", path: "$[*].email", format: "email" },
      { type: "number_range", path: "$[*].age", min: 18, max: 120, integer: true },
      { type: "unique", path: "$[*].email" },
    ] });
    const r = run(def, people);
    expect(r.status).toBe("pass");
    expect(r.checks.map((c) => c.id).slice(-2)).toEqual(["factual_claims_unverified", "rules_authored_by_workspace"]);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
  });

  it("fails with an explanation naming the exact offending values", () => {
    const def = parse({ rules: [{ type: "required_fields", path: "$[*]", fields: ["name", "email"] }, { type: "field_format", path: "$[*].email", format: "email" }, { type: "number_range", path: "$[*].age", min: 18 }] });
    const r = run(def, [{ name: "A", email: "a@x.io", age: 30 }, { name: "", email: "nope", age: 12 }]);
    expect(r.status).toBe("fail");
    const msgs = Object.fromEntries(r.checks.map((c) => [c.id, c.explanation]));
    expect(msgs.rule_1_required_fields).toContain("$[1].name");
    expect(msgs.rule_2_field_format).toContain("$[1].email");
    expect(msgs.rule_3_number_range).toContain("$[1].age");
  });

  it("treats missing paths as failures, never as passes", () => {
    const def = parse({ rules: [{ type: "field_format", path: "$[*].website", format: "http_url" }] });
    expect(run(def, [{ name: "x" }]).status).toBe("fail");
    expect(run(def, { not: "an array" }).status).toBe("fail");
    expect(run(def, null).status).toBe("fail");
  });

  it("detects duplicates case-insensitively and trims", () => {
    const def = parse({ rules: [{ type: "unique", path: "$[*].name" }] });
    expect(run(def, [{ name: "Acme" }, { name: " acme " }]).status).toBe("fail");
    expect(run(def, [{ name: "Acme" }, { name: "Beta" }]).status).toBe("pass");
  });

  it("supports task-parameter thresholds, with defaults, and is inconclusive when a parameter is missing", () => {
    const def = parse({ rules: [{ type: "items", path: "$", min: { param: "minimumResults" } }] });
    expect(run(def, [1, 2, 3], { params: { minimumResults: 3 } }).status).toBe("pass");
    expect(run(def, [1, 2, 3], { params: { minimumResults: 4 } }).status).toBe("fail");
    const missing = run(def, [1, 2, 3]);
    expect(missing.status).toBe("inconclusive");
    const withDefault = parse({ rules: [{ type: "items", path: "$", min: { param: "minimumResults", default: 2 } }] });
    expect(run(withDefault, [1, 2, 3]).status).toBe("pass");
  });

  it("evaluates evidence rules, and is inconclusive when evidence was not supplied", () => {
    const def = parse({ rules: [{ type: "evidence", types: ["tool_call", "tool_result"] }, { type: "evidence_count", min: 3 }] });
    expect(run(def, [], { evidence: ev(["task", "tool_call", "tool_result", "result"]) }).status).toBe("pass");
    const r = run(def, [], { evidence: ev(["task", "tool_call"]) });
    expect(r.status).toBe("fail");
    expect(r.checks[0]!.explanation).toContain("tool_result");
    expect(run(def, []).status).toBe("inconclusive");
  });

  it("one_of and formats", () => {
    const def = parse({ rules: [{ type: "one_of", path: "$[*].tier", values: ["free", "pro"] }, { type: "field_format", path: "$[*].when", format: "iso_date" }] });
    expect(run(def, [{ tier: "pro", when: "2026-10-01" }]).status).toBe("pass");
    expect(run(def, [{ tier: "gold", when: "yesterday" }]).status).toBe("fail");
  });

  it("is deterministic and bounded", () => {
    const def = parse({ rules: [{ type: "unique", path: "$[*]" }] });
    const a = run(def, people);
    expect(JSON.stringify(run(def, people))).toBe(JSON.stringify(a));
    const huge = run(def, Array.from({ length: 10_001 }, (_, i) => i));
    expect(huge.status).toBe("fail");
    expect(huge.checks[0]!.explanation).toMatch(/more than 10000/);
  });
});
