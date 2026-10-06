import { CanonicalizationError, hashValidatorRules, type EvidenceCommitmentInput, type EvidenceType, type JsonValue } from "@verid/core";
import { MAX_DEFINITION_BYTES, describeRule, parseRuleDefinition, runRules, type RuleDefinition } from "@verid/validators";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireRole, type Ctx } from "../context";
import { customValidators } from "../db/schema";
import { ApiError, notFound } from "../errors";
import { newId } from "../ids";
import { VALIDATORS, findValidator, type RegisteredValidator } from "../validator-registry";
import { audit, parse } from "../util";

const CUSTOM_PREFIX = "custom:";
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "3-40 characters: lowercase letters, digits and hyphens");

const isUniqueViolation = (e: unknown) => {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
};

export const createValidatorInput = z.object({
  slug,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(""),
  rules: z.array(z.unknown()),
});
export const newValidatorVersionInput = z
  .object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(500), rules: z.array(z.unknown()) })
  .partial()
  .refine((o) => o.name !== undefined || o.description !== undefined || o.rules !== undefined, "provide name, description and/or rules");

/** Strictly validate and hash a definition. Throws a 400 listing every problem at once. */
function checkedDefinition(rules: unknown[]): { def: RuleDefinition; hash: string } {
  if (Buffer.byteLength(JSON.stringify(rules)) > MAX_DEFINITION_BYTES) throw new ApiError("payload_too_large", `rules exceed ${MAX_DEFINITION_BYTES} bytes`);
  const parsed = parseRuleDefinition({ rules });
  if (!parsed.ok) throw new ApiError("invalid_request", "the rules are not valid", { errors: parsed.errors });
  try {
    return { def: parsed.value, hash: hashValidatorRules(parsed.value as unknown as JsonValue) };
  } catch (e) {
    if (e instanceof CanonicalizationError) throw new ApiError("invalid_request", `rules are not representable: ${e.message}`);
    throw e;
  }
}

/** The string recorded as `validatorVersion`: the version number plus the first bytes of the rules hash. */
export const versionLabel = (version: number, hash: string) => `${version}+${hash.slice(2, 14)}`;

type Row = typeof customValidators.$inferSelect;
const view = (r: Row) => ({
  id: CUSTOM_PREFIX + r.slug, // the id you pass to POST /validations
  slug: r.slug, origin: "workspace" as const, name: r.name, description: r.description, version: r.version,
  versionLabel: versionLabel(r.version, r.definitionHash), definitionHash: r.definitionHash,
  definition: r.definition, rules: (r.definition.rules as Parameters<typeof describeRule>[0][]).map(describeRule), createdAt: r.createdAt,
});

export async function createValidator(ctx: Ctx, raw: unknown) {
  requireRole(ctx.principal, "developer");
  const input = parse(createValidatorInput, raw);
  const { def, hash } = checkedDefinition(input.rules);
  try {
    return await ctx.deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(customValidators)
        .values({ id: newId("vld"), workspaceId: ctx.principal.workspaceId, slug: input.slug, name: input.name, description: input.description, version: 1, definition: def, definitionHash: hash, createdByUserId: ctx.principal.userId ?? null, createdAt: ctx.deps.now() })
        .returning();
      await audit(tx, ctx, "validator.created", { type: "validator", id: CUSTOM_PREFIX + input.slug }, { version: 1, definitionHash: hash });
      return view(row!);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError("conflict", "a validator with that slug already exists");
    throw e;
  }
}

/** Validators are immutable: "editing" creates version N+1 and leaves every earlier version, and every validation that used it, untouched. */
export async function createValidatorVersion(ctx: Ctx, slugParam: string, raw: unknown) {
  requireRole(ctx.principal, "developer");
  const input = parse(newValidatorVersionInput, raw);
  const [latest] = await ctx.deps.db
    .select()
    .from(customValidators)
    .where(and(eq(customValidators.workspaceId, ctx.principal.workspaceId), eq(customValidators.slug, slugParam)))
    .orderBy(desc(customValidators.version))
    .limit(1);
  if (!latest) throw notFound("validator");
  const { def, hash } = input.rules ? checkedDefinition(input.rules) : { def: latest.definition as RuleDefinition, hash: latest.definitionHash };
  try {
    return await ctx.deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(customValidators)
        .values({ id: newId("vld"), workspaceId: ctx.principal.workspaceId, slug: latest.slug, name: input.name ?? latest.name, description: input.description ?? latest.description, version: latest.version + 1, definition: def, definitionHash: hash, createdByUserId: ctx.principal.userId ?? null, createdAt: ctx.deps.now() })
        .returning();
      await audit(tx, ctx, "validator.versioned", { type: "validator", id: CUSTOM_PREFIX + latest.slug }, { version: latest.version + 1, definitionHash: hash });
      return view(row!);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError("conflict", "another version was created at the same time; reload and try again");
    throw e;
  }
}

/** Latest version of every workspace validator, each with its version history. */
export async function listCustomValidators(ctx: Ctx) {
  const rows = await ctx.deps.db
    .select()
    .from(customValidators)
    .where(eq(customValidators.workspaceId, ctx.principal.workspaceId))
    .orderBy(asc(customValidators.slug), desc(customValidators.version));
  const bySlug = new Map<string, Row[]>();
  for (const r of rows) bySlug.set(r.slug, [...(bySlug.get(r.slug) ?? []), r]);
  return [...bySlug.values()].map((versions) => ({
    ...view(versions[0]!),
    versions: versions.map((v) => ({ version: v.version, versionLabel: versionLabel(v.version, v.definitionHash), definitionHash: v.definitionHash, createdAt: v.createdAt })),
  }));
}

export const testValidatorInput = z.object({
  rules: z.array(z.unknown()),
  result: z.unknown(),
  /** Evidence TYPES to pretend were recorded, e.g. ["task","tool_call","tool_result","result"]. Omit to test without evidence. */
  evidenceTypes: z.array(z.string()).max(500).optional(),
  taskParameters: z.record(z.unknown()).optional(),
});

/** Dry run: evaluates rules against a sample result. Nothing is stored and no execution is touched. */
export async function testValidator(ctx: Ctx, raw: unknown) {
  requireRole(ctx.principal, "developer");
  const input = parse(testValidatorInput, raw);
  if (Buffer.byteLength(JSON.stringify(input.result ?? null)) > 256 * 1024) throw new ApiError("payload_too_large", "sample result exceeds 256 KB");
  const { def } = checkedDefinition(input.rules);
  const evidence: EvidenceCommitmentInput[] | undefined = input.evidenceTypes?.map((type, i) => ({
    executionId: "test", sequenceNumber: i, type: type as EvidenceType, timestamp: ctx.deps.now().toISOString(), contentHash: `0x${"00".repeat(32)}` as never,
  }));
  const r = runRules(def, {
    executionId: "test", validatorId: "custom:test", validatorVersion: "test", result: input.result, evidence, taskParameters: (input.taskParameters ?? {}) as Record<string, unknown>, validatedAt: ctx.deps.now().toISOString(),
  });
  return { status: r.status, checks: r.checks };
}

/** Everything `runValidation` needs, for either a built-in or a workspace validator. */
export interface ResolvedValidator {
  id: string;
  version: string;
  run: RegisteredValidator["run"];
}

/** Accepts `research-validator`, `custom:slug` (latest version) or `custom:slug@3` (pinned). */
export async function resolveValidator(ctx: Ctx, id: string): Promise<ResolvedValidator | undefined> {
  const builtin = findValidator(id);
  if (builtin) return { id: builtin.id, version: builtin.version, run: builtin.run };
  const m = /^custom:([a-z0-9-]+)(?:@(\d{1,6}))?$/.exec(id);
  if (!m) return undefined;
  const where = and(eq(customValidators.workspaceId, ctx.principal.workspaceId), eq(customValidators.slug, m[1]!), ...(m[2] ? [eq(customValidators.version, Number(m[2]))] : []));
  const [row] = await ctx.deps.db.select().from(customValidators).where(where).orderBy(desc(customValidators.version)).limit(1);
  if (!row) return undefined;
  const label = versionLabel(row.version, row.definitionHash);
  return {
    id: CUSTOM_PREFIX + row.slug,
    version: label,
    run: (i) =>
      runRules(row.definition as unknown as RuleDefinition, {
        executionId: i.executionId, validatorId: CUSTOM_PREFIX + row.slug, validatorVersion: label, result: i.result, evidence: i.evidence, taskParameters: i.taskParameters, validatedAt: i.validatedAt,
      }),
  };
}

export const builtinValidators = () => VALIDATORS;
