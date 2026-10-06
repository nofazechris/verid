import type { CheckResult, EvidenceCommitmentInput, ValidationResult } from "@verid/core";

/**
 * ResearchValidator v1.0.0 — deterministic, offline, reproducible.
 *
 * WHAT IT CHECKS (structure and internal consistency of the returned data):
 *  - the result is an array of objects with the required fields (schema);
 *  - at least `minimumResults` *qualifying* entries exist, where qualifying =
 *    well-formed, unique, and founded after `foundedAfter`;
 *  - every entry has a name, a syntactically valid http(s) website, an integer
 *    founding year, and >= 1 syntactically valid source URL;
 *  - no duplicate entries (same normalized name or same website host);
 *  - the required evidence kinds were recorded (tool_call, tool_result, result).
 *
 * WHAT IT DOES NOT CHECK (and never claims to):
 *  - that any company exists, is in the requested country, or was founded in
 *    the stated year;
 *  - that source URLs are reachable or support the claim. The validator makes
 *    NO network requests (this also avoids server-side request forgery).
 *  A PASS therefore means "the data is complete, well-formed and consistent",
 *  not "the data is true". This is surfaced as an explicit check below.
 */
export const RESEARCH_VALIDATOR_ID = "research-validator";
export const RESEARCH_VALIDATOR_VERSION = "1.0.0";

export interface ResearchValidatorOptions {
  /** Minimum qualifying entries. Default 10. */
  minimumResults?: number;
  /** Entries must have foundedYear strictly greater than this. Default 2024. */
  foundedAfter?: number;
}

export interface ResearchInput {
  executionId: string;
  /** The agent's result; untrusted. */
  result: unknown;
  /** Evidence recorded for the execution. If omitted the outcome is `inconclusive`. */
  evidence?: EvidenceCommitmentInput[];
  /** ISO timestamp override, for reproducible tests. */
  validatedAt?: string;
}

interface Entry {
  name?: unknown;
  website?: unknown;
  foundedYear?: unknown;
  sources?: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseHttpUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname.includes(".") || u.hostname.endsWith(".")) return null;
  return u;
}

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const normHost = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, "");

const REQUIRED_EVIDENCE = ["tool_call", "tool_result", "result"] as const;

const fmt = (idx: number[]) => `entries ${idx.slice(0, 10).join(", ")}${idx.length > 10 ? ` (+${idx.length - 10} more)` : ""}`;

export function validateResearch(input: ResearchInput, opts: ResearchValidatorOptions = {}): ValidationResult {
  const minimum = opts.minimumResults ?? 10;
  const after = opts.foundedAfter ?? 2024;
  const checks: CheckResult[] = [];

  const add = (id: string, description: string, ok: boolean, explanation?: string, details?: CheckResult["details"]) =>
    checks.push({
      id,
      description,
      ok,
      determinate: true,
      ...(explanation && !ok ? { explanation } : {}),
      ...(details !== undefined ? { details } : {}),
    });

  const isArray = Array.isArray(input.result);
  const rows: unknown[] = isArray ? (input.result as unknown[]) : [];
  const objects = rows.every(isRecord);
  add(
    "schema_conforms",
    "Result is an array of objects",
    isArray && objects,
    !isArray ? "result is not an array" : !objects ? "result contains non-object entries" : undefined,
  );

  const entries = rows.filter(isRecord) as Entry[];
  const badName: number[] = [];
  const badSite: number[] = [];
  const badYear: number[] = [];
  const noSource: number[] = [];
  const notAfter: number[] = [];

  entries.forEach((e, i) => {
    if (typeof e.name !== "string" || e.name.trim() === "") badName.push(i);
    if (!parseHttpUrl(e.website)) badSite.push(i);
    if (typeof e.foundedYear !== "number" || !Number.isInteger(e.foundedYear)) badYear.push(i);
    else if (e.foundedYear <= after) notAfter.push(i);
    const s = e.sources;
    if (!Array.isArray(s) || s.length === 0 || !s.every((x) => parseHttpUrl(x))) noSource.push(i);
  });

  add("names_present", "Every entry has a name", badName.length === 0, `missing or empty name in ${fmt(badName)}`);
  add("websites_valid", "Every entry has a valid website URL", badSite.length === 0, `invalid website in ${fmt(badSite)}`);
  add("founding_year_present", "Every entry has an integer founding year", badYear.length === 0, `missing or non-integer foundedYear in ${fmt(badYear)}`);
  add("sources_present", "Every entry has at least one valid source URL", noSource.length === 0, `missing or invalid sources in ${fmt(noSource)}`);
  add("founded_after", `Every founding year is later than ${after}`, notAfter.length === 0, `foundedYear <= ${after} in ${fmt(notAfter)}`);

  // Duplicate detection (by normalized name OR website host).
  const seenName = new Map<string, number>();
  const seenHost = new Map<string, number>();
  const dupIdx: number[] = [];
  const uniqueGood = new Set<number>();
  entries.forEach((e, i) => {
    const n = typeof e.name === "string" && e.name.trim() ? normName(e.name) : null;
    const u = parseHttpUrl(e.website);
    const h = u ? normHost(u) : null;
    const dup = (n !== null && seenName.has(n)) || (h !== null && seenHost.has(h));
    if (dup) dupIdx.push(i);
    if (n !== null && !seenName.has(n)) seenName.set(n, i);
    if (h !== null && !seenHost.has(h)) seenHost.set(h, i);
    const qualifies =
      !dup &&
      n !== null &&
      h !== null &&
      typeof e.foundedYear === "number" &&
      Number.isInteger(e.foundedYear) &&
      e.foundedYear > after &&
      Array.isArray(e.sources) &&
      e.sources.length > 0 &&
      e.sources.every((x) => parseHttpUrl(x));
    if (qualifies) uniqueGood.add(i);
  });
  add("no_duplicates", "No duplicate entries (by name or website host)", dupIdx.length === 0, `duplicate ${fmt(dupIdx)}`);

  add(
    "min_entries",
    `At least ${minimum} qualifying entries`,
    uniqueGood.size >= minimum,
    `found ${uniqueGood.size} qualifying entries, required ${minimum}`,
    { qualifying: uniqueGood.size, required: minimum },
  );

  // Evidence presence.
  let evidenceRefs: number[] = [];
  if (!input.evidence) {
    checks.push({
      id: "evidence_present",
      description: "Required evidence was recorded",
      ok: false,
      determinate: false,
      explanation: "evidence was not supplied to the validator",
    });
  } else {
    const types = new Set(input.evidence.map((e) => e.type));
    const missing = REQUIRED_EVIDENCE.filter((t) => !types.has(t));
    add("evidence_present", "Required evidence was recorded", missing.length === 0, `missing evidence types: ${missing.join(", ")}`);
    evidenceRefs = [...input.evidence].map((e) => e.sequenceNumber).sort((a, b) => a - b);
  }

  // Explicit, honest limitation (informational; does not affect the outcome).
  checks.push({
    id: "factual_claims_unverified",
    description: "Existence, location, founding dates and source content were NOT independently confirmed",
    ok: true,
    determinate: false,
  });

  const status = checks.some((c) => c.determinate && !c.ok)
    ? "fail"
    : checks.some((c) => !c.determinate && !c.ok)
    ? "inconclusive"
    : "pass";

  return {
    validatorId: RESEARCH_VALIDATOR_ID,
    validatorVersion: RESEARCH_VALIDATOR_VERSION,
    executionId: input.executionId,
    status,
    checks,
    evidenceRefs,
    validatedAt: input.validatedAt ?? new Date().toISOString(),
  };
}

/** Human-readable rule summary for the validators page / docs. */
export const RESEARCH_VALIDATOR_RULES = [
  "result is an array of objects",
  "name, website (http/https), integer foundedYear, and >=1 source URL on every entry",
  "foundedYear strictly greater than the task's foundedAfter (default 2024)",
  "no duplicates by normalized name or website host",
  ">= minimumResults qualifying entries (default 10)",
  "evidence includes tool_call, tool_result and result records",
  "makes no network requests; does not confirm factual truth of the data",
] as const;
