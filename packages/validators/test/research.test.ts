import { describe, expect, it } from "vitest";
import { hashEvidenceContent, hashValidationResult, type EvidenceCommitmentInput } from "@verid/core";
import { validateResearch } from "../src";

// ILLUSTRATIVE test data only: .example domains, fabricated names. Not real companies.
const entry = (i: number, over: Record<string, unknown> = {}) => ({
  name: `Fixture Startup ${i}`,
  website: `https://startup-${i}.example.com`,
  foundedYear: 2025,
  sources: [`https://source-${i}.example.org/article`],
  ...over,
});
const entries = (n: number) => Array.from({ length: n }, (_, i) => entry(i));

const evidence: EvidenceCommitmentInput[] = (["tool_call", "tool_result", "result"] as const).map((type, n) => ({
  executionId: "exec_1",
  sequenceNumber: n,
  type,
  timestamp: "2026-10-01T10:00:00.000Z",
  contentHash: hashEvidenceContent({ n }),
}));

// `null` = "no evidence supplied" (a default param would swallow `undefined`).
const run = (result: unknown, ev: EvidenceCommitmentInput[] | null = evidence, opts = {}) =>
  validateResearch({ executionId: "exec_1", result, evidence: ev ?? undefined, validatedAt: "2026-10-01T10:00:05.000Z" }, opts);
const check = (r: ReturnType<typeof run>, id: string) => r.checks.find((c) => c.id === id)!;

describe("ResearchValidator", () => {
  it("passes a complete, well-formed result", () => {
    const r = run(entries(10));
    expect(r.status).toBe("pass");
    expect(r.checks.filter((c) => c.determinate).every((c) => c.ok)).toBe(true);
    expect(check(r, "min_entries").details).toEqual({ qualifying: 10, required: 10 });
  });

  it("always declares that factual claims were not verified", () => {
    const c = check(run(entries(10)), "factual_claims_unverified");
    expect(c.determinate).toBe(false);
    expect(c.description).toMatch(/NOT independently confirmed/);
  });

  it("FAILS the deliberately incomplete demo result (6 of 10) with an explanation", () => {
    const r = run(entries(6));
    expect(r.status).toBe("fail");
    const c = check(r, "min_entries");
    expect(c.ok).toBe(false);
    expect(c.explanation).toBe("found 6 qualifying entries, required 10");
    expect(check(r, "schema_conforms").ok).toBe(true);
  });

  it("fails when entries are not > foundedAfter (2024 is not later than 2024)", () => {
    const r = run([...entries(9), entry(9, { foundedYear: 2024 })]);
    expect(r.status).toBe("fail");
    expect(check(r, "founded_after").explanation).toMatch(/entries 9/);
    expect(check(r, "min_entries").ok).toBe(false);
  });

  it("rejects duplicates by name (case/space-insensitive) and by website host", () => {
    const byName = run([...entries(10), entry(99, { name: "  fixture   STARTUP 3 " })]);
    expect(check(byName, "no_duplicates").ok).toBe(false);
    const byHost = run([...entries(10), entry(98, { website: "https://www.startup-4.example.com/about" })]);
    expect(check(byHost, "no_duplicates").ok).toBe(false);
    expect(byHost.status).toBe("fail");
  });

  it("duplicates do not count toward the minimum", () => {
    const r = run([...entries(9), entry(0)]); // 10 rows, 9 unique
    expect(check(r, "min_entries").details).toEqual({ qualifying: 9, required: 10 });
    expect(r.status).toBe("fail");
  });

  it.each([
    ["missing name", { name: "" }, "names_present"],
    ["non-http website", { website: "ftp://x.example.com" }, "websites_valid"],
    ["website without a dot host", { website: "http://localhost" }, "websites_valid"],
    ["garbage website", { website: "not a url" }, "websites_valid"],
    ["string year", { foundedYear: "2025" }, "founding_year_present"],
    ["fractional year", { foundedYear: 2025.5 }, "founding_year_present"],
    ["no sources", { sources: [] }, "sources_present"],
    ["invalid source url", { sources: ["nope"] }, "sources_present"],
  ])("detects %s", (_n, over, id) => {
    const r = run([...entries(10), entry(50, over)]);
    expect(check(r, id).ok).toBe(false);
    expect(r.status).toBe("fail");
  });

  it("fails on non-array and non-object rows", () => {
    expect(run({ not: "an array" }).status).toBe("fail");
    expect(check(run([1, "x", null]), "schema_conforms").ok).toBe(false);
  });

  it("is inconclusive (not pass) when evidence is not supplied", () => {
    const r = run(entries(10), null);
    expect(r.status).toBe("inconclusive");
    expect(check(r, "evidence_present").determinate).toBe(false);
  });

  it("fails when required evidence kinds are missing", () => {
    const r = run(entries(10), evidence.filter((e) => e.type !== "tool_result"));
    expect(r.status).toBe("fail");
    expect(check(r, "evidence_present").explanation).toMatch(/tool_result/);
  });

  it("a determinate failure outranks an indeterminate check", () => {
    expect(run(entries(3), null).status).toBe("fail");
  });

  it("honors custom task parameters", () => {
    expect(run(entries(3), evidence, { minimumResults: 3 }).status).toBe("pass");
    expect(run([entry(0, { foundedYear: 2026 })], evidence, { minimumResults: 1, foundedAfter: 2025 }).status).toBe("pass");
  });

  it("is deterministic: same input yields an identical, identically-hashed result", () => {
    const a = run(entries(10));
    const b = run(entries(10));
    expect(a).toEqual(b);
    expect(hashValidationResult(a)).toBe(hashValidationResult(b));
    expect(hashValidationResult(run(entries(9)))).not.toBe(hashValidationResult(a));
  });

  it("does not mutate its input", () => {
    const input = entries(10);
    const snapshot = JSON.stringify(input);
    run(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
