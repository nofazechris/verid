/** Visual language for the execution graph (ported from the design). */
export const ICON: Record<string, string> = {
  task: "M9 3h6v3H9z M8 4.5H5.5V21h13V4.5H16 M9 11h6 M9 15h4",
  policy: "M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z M9 12l2 2 4-4",
  agent: "M12 3.5v3 M6.5 6.5h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z M9.5 11.5v1 M14.5 11.5v1 M9.5 15.5h5 M2 12v3 M22 12v3",
  call: "M4 5h16v14H4z M7.5 9.5l3 2.5-3 2.5 M12.5 15h4",
  result: "M12 4v10 M8 10l4 4 4-4 M5 19.5h14",
  evidence: "M12 3l9 5-9 5-9-5z M3 12.5l9 5 9-5 M3 16.5l9 5 9-5",
  validator: "M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M8 12.5l3 3 5-6.5",
  settlement: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2-.4-2.5-1.2 M12 6.5V8 M12 16v1.5",
  arc: "M12 3.5a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M12 7.5V21 M5 13.5a7 7 0 0 0 14 0 M8.5 11h7",
};

const RAD: Record<string, string> = { agent: "50%", settlement: "50%", arc: "14px 14px 14px 4px" };

export type NodeState = "done" | "run" | "wait" | "fail" | "idle";

const PAL: Record<NodeState, string[]> = {
  done: ["#2C8A66", "#10241A", "#4ADE80", "#E8ECE9", "✓", "none"],
  run: ["#4ADE80", "#0F2217", "#4ADE80", "#E8ECE9", "●", "apPulse 1.2s ease-in-out infinite"],
  wait: ["#B89A5A", "#1E1B13", "#CDB274", "#E8ECE9", "◷", "apPulseAmber 1.8s ease-in-out infinite"],
  fail: ["#A65D5D", "#241617", "#D08A8A", "#D08A8A", "✕", "none"],
  idle: ["#303832", "#101311", "#5F6762", "#7C847F", "", "none"],
};
const CORNER: Record<NodeState, string[]> = {
  done: ["#10241A", "#2C8A66", "#4ADE80"],
  fail: ["#241617", "#A65D5D", "#D08A8A"],
  wait: ["#1E1B13", "#B89A5A", "#CDB274"],
  run: ["#101311", "#303832", "#7C847F"],
  idle: ["#101311", "#303832", "#7C847F"],
};

export function nodeStyle(state: NodeState, key: string, opts: { selected?: boolean; pulse?: boolean } = {}) {
  const M = PAL[state];
  const C = CORNER[state];
  const show = state === "done" || state === "fail" || state === "wait";
  return {
    icon: ICON[key] ?? ICON.task,
    rad: RAD[key] ?? "11px",
    bd: M[0]!, bg: M[1]!, fg: M[2]!, lc: M[3]!, glyph: M[4]!, anim: M[5]!,
    cb: C[0]!, cbd: C[1]!, cfg: C[2]!, cop: show ? 1 : 0, csc: show ? 1 : 0.4,
    glow: opts.pulse && state === "done" ? "0 0 0 4px rgba(74,222,128,0.10), 0 0 28px rgba(74,222,128,0.40)" : "0 0 0 0 rgba(0,0,0,0)",
    ring: opts.selected ? "2px solid rgba(232,236,233,0.75)" : "2px solid transparent",
  };
}

export const NODE_KEYS = ["task", "policy", "agent", "call", "result", "evidence", "validator", "settlement", "arc"] as const;
export type NodeKey = (typeof NODE_KEYS)[number];
export const NODE_LABEL: Record<NodeKey, string> = {
  task: "TASK", policy: "POLICY", agent: "AGENT", call: "TOOL CALL", result: "TOOL RESULT", evidence: "EVIDENCE",
  validator: "VALIDATOR", settlement: "SETTLEMENT", arc: "ARC",
};

interface ExecLike {
  status: string;
  evidenceRoot: string | null;
  policy: unknown;
  validation: { status: string } | null;
  settlement?: { status: string } | null;
  anchor?: { status: string } | null;
}
interface EvLike {
  type: string;
}

/**
 * Derive each stage's REAL state from the stored records. A stage is only "done" if the thing it
 * represents actually exists; stages that did not occur (no policy, no settlement, not anchored) are
 * "idle" with an explanatory subtitle — never shown as completed.
 */
export function deriveNodes(ex: ExecLike, ev: EvLike[]): { key: NodeKey; state: NodeState; sub: string }[] {
  const n = (t: string) => ev.filter((e) => e.type === t).length;
  const calls = n("tool_call");
  const results = n("tool_result");
  const v = ex.validation?.status;
  // Anchored is a fact about the confirmed anchor, not about the current status (a settled execution was anchored).
  const anchored = ex.anchor?.status === "confirmed" || ex.status === "anchored";
  const awaiting = ex.status === "awaiting_validation" || ex.status === "evidence_captured";
  return [
    { key: "task", state: "done", sub: "defined" },
    { key: "policy", state: ex.policy ? "done" : "idle", sub: ex.policy ? "bound" : "none" },
    { key: "agent", state: "done", sub: "recorded" },
    { key: "call", state: calls ? "done" : ex.status === "running" ? "run" : "idle", sub: calls ? `${calls} recorded` : "none yet" },
    { key: "result", state: results ? "done" : ex.status === "running" ? "run" : "idle", sub: results ? `${results} recorded` : "none yet" },
    { key: "evidence", state: ex.evidenceRoot ? "done" : ex.status === "running" ? "run" : "idle", sub: ex.evidenceRoot ? "committed" : "uncommitted" },
    { key: "validator", state: v === "pass" ? "done" : v ? "fail" : awaiting ? "wait" : "idle", sub: v ? v : awaiting ? "awaiting" : "not run" },
    {
      key: "settlement",
      state: ex.settlement?.status === "released" ? "done" : ex.settlement?.status === "refunded" ? "fail" : ex.settlement ? "wait" : "idle",
      sub: ex.settlement ? ex.settlement.status : "not requested",
    },
    {
      key: "arc",
      state: anchored ? "done" : ex.status === "anchoring" ? "wait" : "idle",
      sub: anchored ? "anchored" : ex.status === "anchoring" ? "pending" : v && v !== "pass" ? "not anchorable" : "not anchored",
    },
  ];
}
