import { and, desc, eq, inArray } from "drizzle-orm";
import type { Ctx } from "../context";
import { executions, validations } from "../db/schema";

/**
 * Agent monitoring, derived ONLY from recorded executions and validations (nothing is simulated or sampled from
 * elsewhere). It looks at the most recent runs of each agent, so it describes recent behaviour, not all of history;
 * the exact lifetime counts come from the agent's own totals.
 *
 * Health is a plain-language reading of those runs, never a score:
 *   no_runs   the agent has never reported a run
 *   healthy   recent validated runs are passing
 *   degraded  fewer than 80% of the last 10 finished runs passed (or, with under 3 finished runs, any failure so far)
 *   failing   the last 3 finished runs all failed (validation fail/inconclusive, or the agent itself crashed)
 * `stuckRuns` counts runs that started but have not progressed for over an hour (a hung agent).
 */
export type Health = "no_runs" | "healthy" | "degraded" | "failing";

const RECENT = 300; // runs examined per agent
const OPEN = ["created", "running", "evidence_captured", "awaiting_validation", "anchoring", "settling"];
const STUCK_AFTER_MS = 60 * 60 * 1000;

interface Row {
  id: string;
  agentId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  error: { code: string; message: string } | null;
  vstatus: "pass" | "fail" | "inconclusive" | null;
}

/** Did this run finish, and how? `null` = still in progress, nothing to judge yet. */
function outcome(r: Row): "pass" | "fail" | null {
  if (r.status === "failed") return "fail";
  if (r.vstatus === "pass") return "pass";
  if (r.vstatus === "fail" || r.vstatus === "inconclusive") return "fail";
  return null;
}

export function summarise(rows: Row[], now: Date, detail: boolean) {
  const finished = rows.filter((r) => outcome(r) !== null); // rows are newest-first
  const last10 = finished.slice(0, 10).map(outcome);
  const passRate = last10.length ? last10.filter((o) => o === "pass").length / last10.length : null;
  let health: Health = "no_runs";
  let healthReason = "This agent has not reported a run yet.";
  if (rows.length) {
    if (!finished.length) {
      health = "healthy";
      healthReason = "Runs have started but none has finished yet.";
    } else if (finished.slice(0, 3).length === 3 && finished.slice(0, 3).every((r) => outcome(r) === "fail")) {
      health = "failing";
      healthReason = "The last 3 finished runs all failed.";
    } else if (finished.length < 3 && finished.some((r) => outcome(r) === "fail")) {
      // Too few runs for a percentage to mean much, but a failure is still worth flagging.
      const bad = finished.filter((r) => outcome(r) === "fail").length;
      health = "degraded";
      healthReason = `${bad} of ${finished.length} finished run${finished.length === 1 ? "" : "s"} failed so far (too few runs to judge a trend).`;
    } else if (passRate !== null && last10.length >= 3 && passRate < 0.8) {
      health = "degraded";
      healthReason = `${Math.round(passRate * 100)}% of the last ${last10.length} finished runs passed.`;
    } else {
      health = "healthy";
      healthReason = `${Math.round((passRate ?? 1) * 100)}% of the last ${last10.length} finished runs passed.`;
    }
  }

  const stuck = rows.filter((r) => OPEN.includes(r.status) && now.getTime() - r.updatedAt.getTime() > STUCK_AFTER_MS).length;
  const dayMs = 86_400_000;
  const last24h = rows.filter((r) => now.getTime() - r.createdAt.getTime() <= dayMs).length;
  const base = {
    health,
    healthReason,
    recentPassRate: passRate,
    recentRuns: rows.length,
    last24h,
    stuckRuns: stuck,
    lastRunAt: rows[0]?.createdAt ?? null,
  };
  if (!detail) return base;

  // 14-day daily series (UTC), oldest first
  const days: { date: string; total: number; pass: number; fail: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    days.push({ date: new Date(now.getTime() - i * dayMs).toISOString().slice(0, 10), total: 0, pass: 0, fail: 0 });
  }
  for (const r of rows) {
    const d = days.find((x) => x.date === r.createdAt.toISOString().slice(0, 10));
    if (!d) continue;
    d.total++;
    const o = outcome(r);
    if (o === "pass") d.pass++;
    else if (o === "fail") d.fail++;
  }
  const durations = rows.filter((r) => r.startedAt && r.completedAt).map((r) => (r.completedAt!.getTime() - r.startedAt!.getTime()) / 1000);
  const lastPass = rows.find((r) => outcome(r) === "pass");
  const lastFail = rows.find((r) => outcome(r) === "fail");
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return {
    ...base,
    byStatus,
    series: days,
    avgDurationSeconds: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null,
    lastPassAt: lastPass?.createdAt ?? null,
    lastFailure: lastFail ? { at: lastFail.createdAt, executionId: lastFail.id, kind: lastFail.status === "failed" ? "agent_error" : "validation", message: lastFail.error?.message ?? (lastFail.vstatus ? `validation ${lastFail.vstatus}` : "failed") } : null,
    recent: rows.slice(0, 8).map((r) => ({ id: r.id, status: r.status, validation: r.vstatus, createdAt: r.createdAt, error: r.error?.message ?? null })),
  };
}

/** Monitoring for one or more agents of the caller's workspace. */
export async function agentMonitoring(ctx: Ctx, agentIds: string[], detail: boolean) {
  const out = new Map<string, ReturnType<typeof summarise>>();
  if (!agentIds.length) return out;
  const rows = await ctx.deps.db
    .select({
      id: executions.id, agentId: executions.agentId, status: executions.status, createdAt: executions.createdAt, updatedAt: executions.updatedAt,
      startedAt: executions.startedAt, completedAt: executions.completedAt, error: executions.error, vstatus: validations.status,
    })
    .from(executions)
    .leftJoin(validations, eq(validations.executionId, executions.id))
    .where(and(eq(executions.workspaceId, ctx.principal.workspaceId), inArray(executions.agentId, agentIds)))
    .orderBy(desc(executions.createdAt), desc(executions.id))
    .limit(RECENT * agentIds.length);
  const by = new Map<string, Row[]>();
  for (const r of rows as Row[]) {
    const list = by.get(r.agentId) ?? [];
    if (list.length < RECENT) list.push(r);
    by.set(r.agentId, list);
  }
  const now = ctx.deps.now();
  for (const id of agentIds) out.set(id, summarise(by.get(id) ?? [], now, detail));
  return out;
}
