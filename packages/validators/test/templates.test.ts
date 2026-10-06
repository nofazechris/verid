import { describe, expect, it } from "vitest";
import type { EvidenceCommitmentInput, EvidenceType } from "@verid/core";
import { VALIDATOR_TEMPLATES } from "../../../apps/web/lib/client/validator-templates";
import { parseRuleDefinition, runRules } from "../src";

const evidence = (types: string[]): EvidenceCommitmentInput[] =>
  types.map((type, i) => ({ executionId: "e", sequenceNumber: i, type: type as EvidenceType, timestamp: "2026-10-06T00:00:00.000Z", contentHash: `0x${"11".repeat(32)}` as never }));

describe("validator templates shipped in the dashboard", () => {
  it("there are templates, with unique ids and slugs", () => {
    expect(VALIDATOR_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(VALIDATOR_TEMPLATES.map((t) => t.id)).size).toBe(VALIDATOR_TEMPLATES.length);
    expect(new Set(VALIDATOR_TEMPLATES.map((t) => t.slug)).size).toBe(VALIDATOR_TEMPLATES.length);
  });

  for (const t of VALIDATOR_TEMPLATES) {
    it(`${t.name}: rules are valid, slug is acceptable, and its own sample PASSES`, () => {
      const parsed = parseRuleDefinition({ rules: t.rules });
      expect(parsed.ok, parsed.ok ? "" : (parsed as { errors: string[] }).errors.join("; ")).toBe(true);
      expect(t.slug).toMatch(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);
      if (!parsed.ok) return;
      const r = runRules(parsed.value, { executionId: "e", validatorId: "custom:t", validatorVersion: "1", result: t.sample, evidence: evidence(t.evidenceTypes), taskParameters: t.taskParameters, validatedAt: "2026-10-06T00:00:00.000Z" });
      expect(r.checks.filter((c) => !c.ok).map((c) => `${c.description}: ${c.explanation}`)).toEqual([]);
      expect(r.status).toBe("pass");
    });

    it(`${t.name}: an empty result is rejected (the rules are not vacuous)`, () => {
      const parsed = parseRuleDefinition({ rules: t.rules });
      if (!parsed.ok) throw new Error("invalid");
      const hasResultRule = t.rules.some((x) => (x as { type: string }).type !== "evidence" && (x as { type: string }).type !== "evidence_count");
      if (!hasResultRule) return; // tool-audit style templates judge evidence, not the result shape
      const r = runRules(parsed.value, { executionId: "e", validatorId: "custom:t", validatorVersion: "1", result: null, evidence: evidence(t.evidenceTypes), taskParameters: t.taskParameters, validatedAt: "2026-10-06T00:00:00.000Z" });
      expect(r.status).toBe("fail");
    });
  }
});
