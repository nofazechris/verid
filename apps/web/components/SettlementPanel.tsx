"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatUnits } from "viem";
import { s } from "@/lib/style";
import { Btn, Field } from "@/components/ui";
import { Card, Label, Mono, Spinner, ghostBtn, ghostHover, inputCss, primaryBtn, primaryHover } from "@/components/kit";
import { ApiClientError, errorMessage, post } from "@/lib/client/api";
import { explorerTxUrl, fmtDateTime, short } from "@/lib/client/format";
import { useCan, useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/useApi";
import { fundEscrow, hasWallet, walletErrorMessage, type FundingParams } from "@/lib/client/wallet";

const usdc = (base: string) => `${Number(formatUnits(BigInt(base), 6)).toLocaleString("en-US", { maximumFractionDigits: 6 })} USDC`;

const Note = ({ children }: { children: ReactNode }) => (
  <p style={s("margin:0;font-size:12.5px;color:#9BA39E;line-height:1.55")}>{children}</p>
);
const Row = ({ k, v }: { k: string; v: ReactNode }) => (
  <div style={s("display:flex;justify-content:space-between;align-items:center;gap:16px;padding:9px 0;border-bottom:1px solid #1D221F")}>
    <span style={s("font-size:13px;color:#7C847F")}>{k}</span>
    <span style={s("text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis")}>{v}</span>
  </div>
);

function Tx({ hash }: { hash: string | null | undefined }) {
  if (!hash) return <Mono color="#7C847F">—</Mono>;
  const link = explorerTxUrl(hash);
  return link ? <a href={link} target="_blank" rel="noreferrer" style={{ color: "#4ADE80", fontFamily: "'Geist Mono',monospace", fontSize: 12.5 }}>{short(hash)} ↗</a> : <Mono>{short(hash)}</Mono>;
}

/** What the next legitimate action is, in words, given the live chain state. */
function nextStep(d: any): string {
  const st = d.settlement?.status;
  if (st === "released") return "The escrow was released to the payee after the validation passed and was anchored.";
  if (st === "refunded") return "The escrow was refunded to the payer.";
  const r = d.readiness;
  if (r?.release) return "The escrow can be released: the validation Pass is recorded on-chain and the receipt is anchored.";
  if (r?.refund) return "The escrow can be refunded to the payer (a recorded failure or an expired deadline).";
  if (d.executionStatus === "validation_failed") return "Validation failed. Settle to record the failure on-chain and refund the payer.";
  if (d.executionStatus === "anchored") return "Anchored. Settle to record the validation on-chain and release the funds.";
  return "Funds are locked. They can be released only after the validation passes and the receipt is anchored; the payer is refunded after a recorded failure or when the deadline passes.";
}

export default function SettlementPanel({ executionId, executionStatus, onChange }: { executionId: string; executionStatus?: string; onChange?: () => void }) {
  const { toast } = useSession();
  const canWrite = useCan("developer");
  const q = useApi<any>(`/executions/${executionId}/settlement`);
  const [busy, setBusy] = useState("");
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("25");
  const [days, setDays] = useState("7");

  // The readiness shown here depends on the execution's state (e.g. it becomes releasable once anchored).
  const seen = useRef(executionStatus);
  useEffect(() => {
    if (seen.current !== executionStatus) {
      seen.current = executionStatus;
      q.reload();
    }
  }, [executionStatus, q]);

  const d = q.data;
  if (q.loading && !d) return <Card gap={12}><Label>USDC SETTLEMENT</Label><span style={s("display:flex;gap:8px;align-items:center;font-size:12.5px;color:#9BA39E")}><Spinner size={12} /> Loading…</span></Card>;
  if (!d) return <Card gap={12}><Label>USDC SETTLEMENT</Label><Note>Could not load settlement: {errorMessage(q.error)}</Note></Card>;
  if (!d.escrow.configured) {
    return (
      <Card gap={12}>
        <Label>USDC SETTLEMENT</Label>
        <Note>Escrow settlement is not enabled on this deployment (no escrow contract is configured). Nothing here has been paid or can be released.</Note>
      </Card>
    );
  }

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : walletErrorMessage(e));
    } finally {
      setBusy("");
      setStep("");
      q.reload();
      onChange?.();
    }
  };

  const register = () => run("register", async () => {
    await post(`/executions/${executionId}/settlement`);
    toast("Escrow linked to this execution");
  });
  const fund = () => run("fund", async () => {
    const p: FundingParams = { ...d.escrow };
    await fundEscrow(p, { payee, amount, deadlineDays: Number(days) }, setStep);
    setStep("Linking the escrow to this execution…");
    if (canWrite) {
      await post(`/executions/${executionId}/settlement`);
      toast("Escrow funded and linked");
    } else toast("Escrow funded. A developer must link it to this execution.");
  });
  const settle = () => run("settle", async () => {
    const r = await post<any>(`/executions/${executionId}/settle`);
    toast(r.pending ? "Submitted: waiting for confirmation" : r.settlement?.status === "released" ? "Released to the payee" : "Refunded to the payer");
  });

  const st = d.settlement;
  const oc = d.onchain;
  const canSettle = canWrite && st?.status === "escrowed" && ["anchored", "settling", "validation_failed"].includes(d.executionStatus);

  return (
    <Card gap={14}>
      <div style={s("display:flex;align-items:center;gap:10px")}>
        <Label>USDC SETTLEMENT</Label>
        {st && <span style={s(`font-family:'Geist Mono',monospace;font-size:11px;letter-spacing:0.08em;color:${st.status === "released" ? "#4ADE80" : st.status === "refunded" ? "#D08A8A" : "#CDB274"}`)}>{st.status.toUpperCase()}</span>}
      </div>

      {st ? (
        <>
          <div>
            <Row k="Amount" v={<Mono size={14}>{usdc(st.amount)}</Mono>} />
            <Row k="Payer" v={<Mono>{short(st.requesterAddress, 8, 6)}</Mono>} />
            <Row k="Payee" v={<Mono>{short(st.recipientAddress, 8, 6)}</Mono>} />
            <Row k="Refund deadline" v={<Mono>{fmtDateTime(new Date(st.deadline * 1000).toISOString())}</Mono>} />
            {st.releaseTxHash && <Row k="Release transaction" v={<Tx hash={st.releaseTxHash} />} />}
            {st.refundTxHash && <Row k="Refund transaction" v={<Tx hash={st.refundTxHash} />} />}
            <Row k="Escrow contract" v={<Mono>{short(st.escrowAddress, 8, 6)}</Mono>} />
          </div>
          <Note>{nextStep(d)}</Note>
          {d.onchainError && <Note>The chain could not be read just now ({d.onchainError}). The status above is the last one recorded.</Note>}
          {canSettle && (
            <div>
              <Btn onClick={settle} disabled={busy === "settle"} css={primaryBtn} hover={primaryHover}>{busy === "settle" ? <Spinner /> : null} Settle escrow</Btn>
            </div>
          )}
        </>
      ) : oc?.status === "funded" ? (
        <>
          <div>
            <Row k="Funded on-chain" v={<Mono size={14}>{usdc(oc.amount)}</Mono>} />
            <Row k="Payer" v={<Mono>{short(oc.payer, 8, 6)}</Mono>} />
            <Row k="Payee" v={<Mono>{short(oc.payee, 8, 6)}</Mono>} />
          </div>
          <Note>An escrow for this execution exists on-chain but is not linked here yet. Linking reads the payer, payee and amount from the chain; nothing is taken from your input.</Note>
          {canWrite && <div><Btn onClick={register} disabled={busy === "register"} css={primaryBtn} hover={primaryHover}>{busy === "register" ? <Spinner /> : null} Link escrow</Btn></div>}
        </>
      ) : (
        <>
          <Note>
            Lock USDC for this execution. It is paid to the payee only after the validation passes <b>and</b> the receipt is anchored on Arc; otherwise it returns to you. The contract has no admin and no way to cancel early: that guarantee is what the payee relies on. A validation Pass is a recorded claim by the registered validator, not proof the work is correct.
          </Note>
          <div style={s("display:flex;flex-direction:column;gap:10px")}>
            <label style={s("display:flex;flex-direction:column;gap:6px;font-size:12px;color:#7C847F")}>Payee address
              <Field value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="0x…" spellCheck={false} css={inputCss + ";font-family:'Geist Mono',monospace"} />
            </label>
            <div style={s("display:flex;gap:10px")}>
              <label style={s("display:flex;flex-direction:column;gap:6px;font-size:12px;color:#7C847F;flex:1")}>Amount (USDC)
                <Field value={amount} onChange={(e) => setAmount(e.target.value)} css={inputCss} />
              </label>
              <label style={s("display:flex;flex-direction:column;gap:6px;font-size:12px;color:#7C847F;width:120px")}>Deadline (days)
                <Field value={days} onChange={(e) => setDays(e.target.value)} css={inputCss} />
              </label>
            </div>
          </div>
          <Note>Network: <Mono size={12}>{d.escrow.network}</Mono> (chain {d.escrow.chainId}). You will confirm two wallet prompts: approve, then create. Verid never holds your keys.</Note>
          <div style={s("display:flex;gap:10px;align-items:center;flex-wrap:wrap")}>
            <Btn onClick={fund} disabled={busy !== "" || !hasWallet()} css={primaryBtn + (!hasWallet() ? ";opacity:.5;cursor:default" : "")} hover={primaryHover}>{busy === "fund" ? <Spinner /> : null} Connect wallet &amp; fund</Btn>
            {!hasWallet() && <span style={s("font-size:12px;color:#7C847F")}>No browser wallet detected.</span>}
          </div>
        </>
      )}

      {step && <span style={s("display:flex;gap:8px;align-items:center;font-size:12.5px;color:#9BA39E")}><Spinner size={12} /> {step}</span>}
      {error && <span role="alert" style={s("font-size:12.5px;color:#D08A8A;line-height:1.5")}>{error}</span>}
      {!busy && <div><Btn onClick={q.reload} css={ghostBtn + ";height:30px;font-size:12px"} hover={ghostHover}>Refresh from chain</Btn></div>}
    </Card>
  );
}
