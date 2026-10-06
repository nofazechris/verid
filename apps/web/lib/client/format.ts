export interface Badge {
  label: string;
  icon: string;
  fg: string;
  bg: string;
  bd: string;
}

const G = { fg: "#4ADE80", bg: "rgba(74,222,128,0.07)", bd: "rgba(74,222,128,0.24)" };
const A = { fg: "#CDB274", bg: "rgba(184,154,90,0.09)", bd: "rgba(184,154,90,0.30)" };
const N = { fg: "#9BA39E", bg: "rgba(155,163,158,0.05)", bd: "#303832" };
const R = { fg: "#D08A8A", bg: "rgba(166,93,93,0.11)", bd: "rgba(166,93,93,0.38)" };

const b = (label: string, icon: string, c: typeof G): Badge => ({ label, icon, ...c });

/** Execution lifecycle status -> badge. Wording is deliberate: only `anchored` says anchored. */
export function executionBadge(status: string): Badge {
  switch (status) {
    case "created": return b("CREATED", "○", N);
    case "running": return b("RUNNING", "◌", A);
    case "evidence_captured":
    case "awaiting_validation": return b("AWAITING VALIDATION", "◐", A);
    case "validated": return b("VALIDATED", "✓", G);
    case "validation_failed": return b("VALIDATION FAILED", "✕", R);
    case "anchoring": return b("ANCHORING", "◌", A);
    case "anchored": return b("ANCHORED", "✓", G);
    case "settling": return b("SETTLING", "◌", A);
    case "settled": return b("SETTLED", "✓", G);
    case "failed": return b("FAILED", "✕", R);
    default: return b(status.toUpperCase(), "·", N);
  }
}

export function validationBadge(status: string | null | undefined): Badge {
  switch (status) {
    case "pass": return b("PASS", "✓", G);
    case "fail": return b("FAIL", "✕", R);
    case "inconclusive": return b("INCONCLUSIVE", "!", A);
    default: return b("NOT VALIDATED", "–", N);
  }
}

export function anchorBadge(status: string | null | undefined): Badge {
  switch (status) {
    case "confirmed": return b("ANCHORED", "✓", G);
    case "submitted": return b("PENDING", "◌", A);
    case "reverted": return b("REVERTED", "✕", R);
    case "dropped": return b("DROPPED", "✕", R);
    default: return b("NOT ANCHORED", "–", N);
  }
}

/** Verification-check status -> badge colour (CONFIRMED/MATCH/VALID are green; INVALID red; the rest are NOT proof). */
export function checkBadge(status: string): Badge {
  switch (status) {
    case "VALID":
    case "CONFIRMED":
    case "MATCH": return b(status, "✓", G);
    case "INVALID": return b(status, "✕", R);
    case "PENDING":
    case "UNAVAILABLE": return b(status, "◌", A);
    default: return b(status, "–", N); // NOT_CHECKED
  }
}

/** 0x1234…cdef */
export function short(hash: string | null | undefined, head = 6, tail = 4): string {
  if (!hash) return "—";
  return hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function ago(iso: string | Date | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`;
}

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 38);

/** Download a JSON object as a file in the browser. */
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Explorer link for a transaction. Arc's docs do not document the explorer's URL scheme, so a link is
 * only produced when NEXT_PUBLIC_ARC_EXPLORER_URL is set (and "/tx/<hash>" is assumed). Otherwise null.
 */
export function explorerTxUrl(hash: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL;
  return base && hash ? `${base.replace(/\/+$/, "")}/tx/${hash}` : null;
}

/** Agent health, as a badge. These are plain-language readings of recent runs, not scores. */
export function healthBadge(health: string | undefined): Badge {
  switch (health) {
    case "healthy": return b("HEALTHY", "●", G);
    case "degraded": return b("DEGRADED", "◐", A);
    case "failing": return b("FAILING", "✕", R);
    default: return b("NO RUNS YET", "○", N);
  }
}
