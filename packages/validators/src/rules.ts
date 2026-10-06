import type { CheckResult, EvidenceCommitmentInput, EvidenceType, ValidationResult } from "@verid/core";

/**
 * Rule-based validators: a workspace describes WHAT a good result looks like as data, and Verid evaluates it
 * deterministically on the server. No code is uploaded or executed, no network is touched, and the same
 * definition always produces the same outcome for the same result, so a definition can be hashed and versioned
 * like a policy.
 *
 * What these validators can establish: structure, completeness, ranges, uniqueness, formats and which kinds of
 * evidence exist. What they cannot: that the content is TRUE. Every result says so in an explicit check, and says
 * the rules were written by the workspace rather than by Verid.
 */

export const FORMATS = ["non_empty_string", "http_url", "email", "iso_date", "integer", "number", "boolean", "non_empty_array"] as const;
export type Format = (typeof FORMATS)[number];

/** A number, or a reference to a task parameter (so one validator can serve tasks with different thresholds). */
export type NumRef = number | { param: string; default?: number };

interface Base {
  /** Optional human description shown in the result instead of the generated one. */
  description?: string;
}
export type Rule =
  | (Base & { type: "items"; path: string; min?: NumRef; max?: NumRef })
  | (Base & { type: "required_fields"; path: string; fields: string[] })
  | (Base & { type: "field_format"; path: string; format: Format })
  | (Base & { type: "number_range"; path: string; min?: NumRef; max?: NumRef; integer?: boolean })
  | (Base & { type: "one_of"; path: string; values: (string | number | boolean)[] })
  | (Base & { type: "unique"; path: string })
  | (Base & { type: "evidence"; types: EvidenceType[]; min?: number })
  | (Base & { type: "evidence_count"; min?: number; max?: number });

export interface RuleDefinition {
  rules: Rule[];
}

export const MAX_RULES = 50;
export const MAX_DEFINITION_BYTES = 20_000;
const MAX_NODES = 10_000;
const MAX_VALUES = 100;
const EVIDENCE_TYPES: readonly string[] = ["task", "tool_call", "tool_result", "model_output", "artifact", "result", "validation"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ------------------------------------------------------------------------ paths

type Token = { kind: "field"; name: string } | { kind: "each" } | { kind: "index"; i: number };

const PATH_RE = /^\$((\.[A-Za-z_][\w-]*|\[\*\]|\[\d{1,6}\])*)$/;

export function parsePath(path: string): Token[] | null {
  if (typeof path !== "string" || path.length > 200 || !PATH_RE.test(path)) return null;
  const out: Token[] = [];
  const re = /\.([A-Za-z_][\w-]*)|\[\*\]|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path.slice(1)))) {
    if (m[1] !== undefined) out.push({ kind: "field", name: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "index", i: Number(m[2]) });
    else out.push({ kind: "each" });
  }
  return out;
}

interface Node {
  value: unknown;
  label: string;
}

/** Resolve a path to its nodes. `value` is `undefined` where the path does not exist. */
function resolve(root: unknown, tokens: Token[]): { nodes: Node[]; error?: string } {
  let cur: Node[] = [{ value: root, label: "$" }];
  for (const t of tokens) {
    const next: Node[] = [];
    for (const n of cur) {
      if (t.kind === "field") {
        next.push({ value: isRecord(n.value) ? n.value[t.name] : undefined, label: `${n.label}.${t.name}` });
      } else if (t.kind === "index") {
        next.push({ value: Array.isArray(n.value) ? n.value[t.i] : undefined, label: `${n.label}[${t.i}]` });
      } else {
        if (!Array.isArray(n.value)) return { nodes: [], error: `expected an array at ${n.label}` };
        n.value.forEach((v, i) => next.push({ value: v, label: `${n.label}[${i}]` }));
      }
      if (next.length > MAX_NODES) return { nodes: [], error: `more than ${MAX_NODES} values matched` };
    }
    cur = next;
  }
  return { nodes: cur };
}

// ---------------------------------------------------------------- definition parsing

export type ParseResult = { ok: true; value: RuleDefinition } | { ok: false; errors: string[] };

const numRef = (v: unknown, where: string, errors: string[]): void => {
  if (v === undefined) return;
  if (typeof v === "number" && Number.isFinite(v)) return;
  if (isRecord(v) && typeof v.param === "string" && /^[A-Za-z_][\w-]{0,59}$/.test(v.param) && (v.default === undefined || (typeof v.default === "number" && Number.isFinite(v.default)))) return;
  errors.push(`${where}: must be a number or {"param": "name", "default": number}`);
};

/** Strictly validate an untrusted definition. Unknown keys are rejected so typos never silently weaken a validator. */
export function parseRuleDefinition(input: unknown): ParseResult {
  const errors: string[] = [];
  if (!isRecord(input) || !Array.isArray(input.rules)) return { ok: false, errors: ['definition must be an object with a "rules" array'] };
  const extra = Object.keys(input).filter((k) => k !== "rules");
  if (extra.length) errors.push(`unknown key(s) at top level: ${extra.join(", ")}`);
  if (input.rules.length === 0) errors.push("add at least one rule");
  if (input.rules.length > MAX_RULES) errors.push(`at most ${MAX_RULES} rules`);

  input.rules.slice(0, MAX_RULES).forEach((r, i) => {
    const w = `rule ${i + 1}`;
    if (!isRecord(r) || typeof r.type !== "string") return void errors.push(`${w}: must be an object with a "type"`);
    const allowed: Record<string, string[]> = {
      items: ["type", "description", "path", "min", "max"],
      required_fields: ["type", "description", "path", "fields"],
      field_format: ["type", "description", "path", "format"],
      number_range: ["type", "description", "path", "min", "max", "integer"],
      one_of: ["type", "description", "path", "values"],
      unique: ["type", "description", "path"],
      evidence: ["type", "description", "types", "min"],
      evidence_count: ["type", "description", "min", "max"],
    };
    const keys = allowed[r.type];
    if (!keys) return void errors.push(`${w}: unknown type "${r.type}" (use ${Object.keys(allowed).join(", ")})`);
    const bad = Object.keys(r).filter((k) => !keys.includes(k));
    if (bad.length) errors.push(`${w} (${r.type}): unknown key(s) ${bad.join(", ")}`);
    if (r.description !== undefined && (typeof r.description !== "string" || r.description.length > 200)) errors.push(`${w}: description must be a string up to 200 characters`);
    if (keys.includes("path")) {
      if (typeof r.path !== "string" || !parsePath(r.path)) errors.push(`${w}: path must look like $, $.field, $[*].field or $.items[*].name`);
    }
    switch (r.type) {
      case "items":
        numRef(r.min, `${w}.min`, errors);
        numRef(r.max, `${w}.max`, errors);
        if (r.min === undefined && r.max === undefined) errors.push(`${w}: set min and/or max`);
        break;
      case "required_fields":
        if (!Array.isArray(r.fields) || r.fields.length === 0 || r.fields.length > 50 || !r.fields.every((f) => typeof f === "string" && /^[A-Za-z_][\w-]{0,59}$/.test(f))) errors.push(`${w}: fields must be 1-50 plain field names`);
        break;
      case "field_format":
        if (!(FORMATS as readonly unknown[]).includes(r.format)) errors.push(`${w}: format must be one of ${FORMATS.join(", ")}`);
        break;
      case "number_range":
        numRef(r.min, `${w}.min`, errors);
        numRef(r.max, `${w}.max`, errors);
        if (r.min === undefined && r.max === undefined && r.integer !== true) errors.push(`${w}: set min, max and/or integer`);
        if (r.integer !== undefined && typeof r.integer !== "boolean") errors.push(`${w}: integer must be true or false`);
        break;
      case "one_of":
        if (!Array.isArray(r.values) || r.values.length === 0 || r.values.length > MAX_VALUES || !r.values.every((v) => ["string", "number", "boolean"].includes(typeof v) && (typeof v !== "string" || v.length <= 200))) errors.push(`${w}: values must be 1-${MAX_VALUES} strings, numbers or booleans`);
        break;
      case "evidence":
        if (!Array.isArray(r.types) || r.types.length === 0 || !r.types.every((t) => typeof t === "string" && EVIDENCE_TYPES.includes(t))) errors.push(`${w}: types must be a non-empty list of ${EVIDENCE_TYPES.join(", ")}`);
        if (r.min !== undefined && !(Number.isInteger(r.min) && (r.min as number) >= 1 && (r.min as number) <= 500)) errors.push(`${w}: min must be a whole number from 1 to 500`);
        break;
      case "evidence_count":
        for (const k of ["min", "max"] as const) {
          if (r[k] !== undefined && !(Number.isInteger(r[k]) && (r[k] as number) >= 0 && (r[k] as number) <= 500)) errors.push(`${w}: ${k} must be a whole number from 0 to 500`);
        }
        if (r.min === undefined && r.max === undefined) errors.push(`${w}: set min and/or max`);
        break;
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: { rules: input.rules as Rule[] } };
}

// ------------------------------------------------------------------------ evaluation

export interface RuleRunInput {
  executionId: string;
  validatorId: string;
  validatorVersion: string;
  result: unknown;
  evidence?: EvidenceCommitmentInput[];
  /** The task's `parameters` object (untrusted). */
  taskParameters?: Record<string, unknown>;
  validatedAt: string;
}

const list = (labels: string[]) => `${labels.slice(0, 5).join(", ")}${labels.length > 5 ? ` and ${labels.length - 5} more` : ""}`;

function formatOk(f: Format, v: unknown): boolean {
  switch (f) {
    case "non_empty_string": return typeof v === "string" && v.trim() !== "";
    case "http_url": {
      if (typeof v !== "string" || v.length === 0 || v.length > 2048) return false;
      try {
        const u = new URL(v);
        return (u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "";
      } catch {
        return false;
      }
    }
    case "email": return typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    case "iso_date": return typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/.test(v) && !Number.isNaN(Date.parse(v));
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "boolean": return typeof v === "boolean";
    case "non_empty_array": return Array.isArray(v) && v.length > 0;
  }
}

const present = (v: unknown) => v !== undefined && v !== null && v !== "" && !(typeof v === "string" && v.trim() === "") && !(Array.isArray(v) && v.length === 0);

export function describeRule(r: Rule): string {
  if (r.description) return r.description;
  const num = (n: NumRef | undefined) => (n === undefined ? "" : typeof n === "number" ? String(n) : `task parameter "${n.param}"${n.default !== undefined ? ` (default ${n.default})` : ""}`);
  switch (r.type) {
    case "items": return `${r.path} has ${r.min !== undefined ? `at least ${num(r.min)}` : ""}${r.min !== undefined && r.max !== undefined ? " and " : ""}${r.max !== undefined ? `at most ${num(r.max)}` : ""} items`;
    case "required_fields": return `Every ${r.path} has: ${r.fields.join(", ")}`;
    case "field_format": return `Every ${r.path} is a valid ${r.format.replace(/_/g, " ")}`;
    case "number_range": return `Every ${r.path} is ${r.integer ? "a whole number" : "a number"}${r.min !== undefined ? ` ≥ ${num(r.min)}` : ""}${r.max !== undefined ? ` ≤ ${num(r.max)}` : ""}`;
    case "one_of": return `Every ${r.path} is one of: ${r.values.join(", ")}`;
    case "unique": return `No duplicate values at ${r.path}`;
    case "evidence": return `Evidence includes ${r.types.join(", ")}${r.min && r.min > 1 ? ` (at least ${r.min} each)` : ""}`;
    case "evidence_count": return `Evidence has ${r.min !== undefined ? `at least ${r.min}` : ""}${r.min !== undefined && r.max !== undefined ? " and " : ""}${r.max !== undefined ? `at most ${r.max}` : ""} records`;
  }
}

/** Evaluate a (previously parsed) definition. Deterministic: depends only on its inputs. */
export function runRules(def: RuleDefinition, input: RuleRunInput): ValidationResult {
  const params = input.taskParameters ?? {};
  const checks: CheckResult[] = [];

  const finish = (id: string, rule: Rule, ok: boolean, explanation: string, determinate = true) =>
    checks.push({ id, description: describeRule(rule), ok, determinate, ...(ok ? {} : { explanation }) });

  /** Resolve a bound; `null` means it depends on a task parameter that was not supplied. */
  const bound = (n: NumRef | undefined): number | undefined | null => {
    if (n === undefined || typeof n === "number") return n;
    const p = params[n.param];
    if (typeof p === "number" && Number.isFinite(p)) return p;
    return n.default !== undefined ? n.default : null;
  };

  def.rules.forEach((rule, i) => {
    const id = `rule_${i + 1}_${rule.type}`;
    if (rule.type === "evidence" || rule.type === "evidence_count") {
      if (!input.evidence) return finish(id, rule, false, "evidence was not supplied to the validator", false);
      if (rule.type === "evidence_count") {
        const n = input.evidence.length;
        const bad = (rule.min !== undefined && n < rule.min) || (rule.max !== undefined && n > rule.max);
        return finish(id, rule, !bad, `found ${n} evidence records`);
      }
      const need = rule.min ?? 1;
      const missing = rule.types.filter((t) => input.evidence!.filter((e) => e.type === t).length < need);
      return finish(id, rule, missing.length === 0, `missing evidence: ${missing.join(", ")}`);
    }

    const tokens = parsePath(rule.path);
    if (!tokens) return finish(id, rule, false, "invalid path", false);
    const { nodes, error } = resolve(input.result, tokens);
    if (error) return finish(id, rule, false, error);

    switch (rule.type) {
      case "items": {
        const lo = bound(rule.min);
        const hi = bound(rule.max);
        if (lo === null || hi === null) return finish(id, rule, false, "a task parameter used by this rule was not provided", false);
        const bad = nodes.filter((n) => !Array.isArray(n.value) || (lo !== undefined && n.value.length < lo) || (hi !== undefined && n.value.length > hi));
        return finish(id, rule, bad.length === 0, bad.map((n) => (Array.isArray(n.value) ? `${n.label} has ${n.value.length} items (required ${lo ?? 0}${hi !== undefined ? `-${hi}` : "+"})` : `${n.label} is not an array`)).slice(0, 3).join("; "));
      }
      case "required_fields": {
        const bad: string[] = [];
        for (const n of nodes) {
          if (!isRecord(n.value)) bad.push(`${n.label} is not an object`);
          else for (const f of rule.fields) if (!present(n.value[f])) bad.push(`${n.label}.${f}`);
        }
        return finish(id, rule, bad.length === 0, `missing or empty: ${list(bad)}`);
      }
      case "field_format": {
        const bad = nodes.filter((n) => !formatOk(rule.format, n.value)).map((n) => n.label);
        return finish(id, rule, bad.length === 0, `not a valid ${rule.format.replace(/_/g, " ")}: ${list(bad)}`);
      }
      case "number_range": {
        const lo = bound(rule.min);
        const hi = bound(rule.max);
        if (lo === null || hi === null) return finish(id, rule, false, "a task parameter used by this rule was not provided", false);
        const bad = nodes.filter((n) => {
          const v = n.value;
          return typeof v !== "number" || !Number.isFinite(v) || (rule.integer === true && !Number.isInteger(v)) || (lo !== undefined && v < lo) || (hi !== undefined && v > hi);
        }).map((n) => n.label);
        return finish(id, rule, bad.length === 0, `out of range or not a number: ${list(bad)}`);
      }
      case "one_of": {
        const bad = nodes.filter((n) => !rule.values.includes(n.value as never)).map((n) => n.label);
        return finish(id, rule, bad.length === 0, `not an allowed value: ${list(bad)}`);
      }
      case "unique": {
        const seen = new Map<string, string>();
        const dup: string[] = [];
        for (const n of nodes) {
          if (n.value === undefined) continue;
          const key = typeof n.value === "string" ? n.value.trim().toLowerCase() : JSON.stringify(n.value);
          if (seen.has(key)) dup.push(`${n.label} duplicates ${seen.get(key)}`);
          else seen.set(key, n.label);
        }
        return finish(id, rule, dup.length === 0, list(dup));
      }
    }
  });

  // Explicit, honest limits (informational; they never change the outcome).
  checks.push({
    id: "factual_claims_unverified",
    description: "Rules check structure and limits only; the truth of the content was NOT independently confirmed",
    ok: true,
    determinate: false,
  });
  checks.push({
    id: "rules_authored_by_workspace",
    description: "These rules were written by the workspace that ran this execution, not by Verid",
    ok: true,
    determinate: false,
  });

  const status = checks.some((c) => c.determinate && !c.ok) ? "fail" : checks.some((c) => !c.determinate && !c.ok) ? "inconclusive" : "pass";
  return {
    validatorId: input.validatorId,
    validatorVersion: input.validatorVersion,
    executionId: input.executionId,
    status,
    checks,
    evidenceRefs: input.evidence ? [...input.evidence].map((e) => e.sequenceNumber).sort((a, b) => a - b) : [],
    validatedAt: input.validatedAt,
  };
}
