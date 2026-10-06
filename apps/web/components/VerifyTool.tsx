"use client";

import { useState } from "react";
import { s } from "@/lib/style";
import { Btn, Area, Field } from "@/components/ui";
import { Mono, Spinner, ghostBtn, ghostHover, inputCss, primaryBtn, primaryHover, MONO } from "@/components/kit";
import VerificationReport, { type Report } from "@/components/VerificationReport";
import { errorMessage, get, post } from "@/lib/client/api";
import { useRouter } from "next/navigation";

/**
 * Public verification tool. Two inputs:
 *  - a receipt ID (verifies the receipt held by this Verid instance, including chain checks);
 *  - a pasted receipt JSON (+ optional bundle JSON) — verifies ANY receipt, even one this server has never seen.
 */
export default function VerifyTool({ basePath }: { basePath: string }) {
  const router = useRouter();
  const [id, setId] = useState("");
  const [receiptText, setReceiptText] = useState("");
  const [bundleText, setBundleText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);

  const byId = async () => {
    const v = id.trim();
    if (!/^rcpt_[A-Za-z0-9_-]{10,}$/.test(v)) return setError("Enter a receipt ID, like rcpt_AbC123…");
    setError("");
    setBusy(true);
    try {
      await get(`/public/receipts/${v}`); // confirm it exists before navigating
      router.push(`${basePath}/${v}`);
    } catch (e) {
      setError((e as { status?: number }).status === 404 ? "No receipt with that ID was found." : errorMessage(e));
      setBusy(false);
    }
  };

  const byJson = async () => {
    setError("");
    setReport(null);
    let receipt: unknown, bundle: unknown;
    try {
      receipt = JSON.parse(receiptText);
    } catch {
      return setError("The receipt is not valid JSON.");
    }
    if (bundleText.trim()) {
      try {
        bundle = JSON.parse(bundleText);
      } catch {
        return setError("The bundle is not valid JSON.");
      }
    }
    setBusy(true);
    try {
      setReport(await post<Report>("/receipts/verify", { receipt, ...(bundle !== undefined ? { bundle } : {}) }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={s("display:flex;flex-direction:column;gap:28px;max-width:880px")}>
      <div style={s("display:flex;flex-direction:column;gap:10px")}>
        <span style={s("font-size:14px;font-weight:500")}>Open a receipt by ID</span>
        <div style={s("display:flex;gap:8px;flex-wrap:wrap")}>
          <Field value={id} onChange={(e) => setId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && byId()} placeholder="rcpt_…" css={inputCss + `;flex:1;min-width:260px;height:44px;font-family:${MONO};font-size:14px`} focus="border-color:#2C8A66" />
          <Btn onClick={byId} disabled={busy} css={primaryBtn + ";height:44px"} hover={primaryHover}>{busy ? <Spinner /> : null} Open</Btn>
        </div>
      </div>

      <div style={s("display:flex;flex-direction:column;gap:10px;border-top:1px solid #1D221F;padding-top:24px")}>
        <span style={s("font-size:14px;font-weight:500")}>Or verify a receipt you were given</span>
        <span style={s("font-size:13px;color:#9BA39E;line-height:1.55")}>Paste a receipt JSON. Add its verification bundle to recompute the task, evidence, result and validation commitments; without it those checks are reported <Mono>NOT_CHECKED</Mono>, never passed.</span>
        <Area value={receiptText} onChange={(e) => setReceiptText(e.target.value)} spellCheck={false} css={inputCss + `;height:150px;padding:10px 12px;resize:vertical;font-family:${MONO};font-size:12px`} />
        <Area value={bundleText} onChange={(e) => setBundleText(e.target.value)} spellCheck={false} css={inputCss + `;height:90px;padding:10px 12px;resize:vertical;font-family:${MONO};font-size:12px`} />
        <span style={s("font-size:12px;color:#7C847F")}>↑ receipt JSON · ↑ bundle JSON (optional)</span>
        <div><Btn onClick={byJson} disabled={busy || !receiptText.trim()} css={ghostBtn} hover={ghostHover}>{busy ? <Spinner /> : null} Verify</Btn></div>
      </div>

      {error && <span role="alert" style={s("font-size:13px;color:#D08A8A")}>{error}</span>}
      {report && <VerificationReport report={report} />}
    </div>
  );
}
