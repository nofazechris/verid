"use client";

import { useMemo, useState } from "react";
import { s } from "@/lib/style";
import { Btn, Area, Field } from "@/components/ui";
import { Card, Label, Mono, Spinner, ghostBtn, ghostHover, inputCss, primaryBtn, primaryHover, MONO } from "@/components/kit";
import { ApiClientError, post, patch } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { VALIDATOR_TEMPLATES, type ValidatorTemplate } from "@/lib/client/validator-templates";

const SNIPPETS: { label: string; rule: object; hint: string }[] = [
  { label: "Item count", rule: { type: "items", path: "$", min: 1 }, hint: "The list at a path has a minimum and/or maximum length." },
  { label: "Required fields", rule: { type: "required_fields", path: "$[*]", fields: ["name"] }, hint: "Every item has these fields, non-empty." },
  { label: "Field format", rule: { type: "field_format", path: "$[*].website", format: "http_url" }, hint: "Formats: non_empty_string, http_url, email, iso_date, integer, number, boolean, non_empty_array." },
  { label: "Number range", rule: { type: "number_range", path: "$[*].score", min: 0, max: 100, integer: true }, hint: "Values are numbers within bounds. Bounds can be { \"param\": \"name\" } to read the task's parameters." },
  { label: "Allowed values", rule: { type: "one_of", path: "$[*].status", values: ["open", "closed"] }, hint: "Every value is one of a fixed list." },
  { label: "No duplicates", rule: { type: "unique", path: "$[*].id" }, hint: "No two items share the same value (case-insensitive for text)." },
  { label: "Evidence kinds", rule: { type: "evidence", types: ["tool_call", "tool_result"] }, hint: "These evidence types were recorded (optionally with min)." },
  { label: "Evidence count", rule: { type: "evidence_count", min: 2 }, hint: "The number of evidence records is within bounds." },
];

const STARTER = [
  { type: "items", path: "$", min: { param: "minimumResults", default: 1 } },
  { type: "required_fields", path: "$[*]", fields: ["name", "website"] },
  { type: "field_format", path: "$[*].website", format: "http_url" },
  { type: "unique", path: "$[*].name" },
  { type: "evidence", types: ["tool_call", "tool_result", "result"] },
];
const SAMPLE = [
  { name: "Acme", website: "https://acme.example.com" },
  { name: "Beta", website: "not-a-url" },
];

const slugify = (v: string) => v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const pretty = (v: unknown) => JSON.stringify(v, null, 2);

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

interface Props {
  /** When set, the editor creates a new immutable VERSION of this validator instead of a new validator. */
  existing?: { slug: string; name: string; description: string; definition: { rules: unknown[] }; version: number };
  onDone: () => void;
  onCancel: () => void;
}

export default function ValidatorEditor({ existing, onDone, onCancel }: Props) {
  const { toast } = useSession();
  const [name, setName] = useState(existing?.name ?? "");
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [rulesText, setRulesText] = useState(pretty(existing?.definition.rules ?? STARTER));
  const [sampleText, setSampleText] = useState(pretty(SAMPLE));
  const [evidenceText, setEvidenceText] = useState("task, tool_call, tool_result, result");
  const [paramsText, setParamsText] = useState("{}");
  const [busy, setBusy] = useState<"" | "save" | "test">("");
  const [errors, setErrors] = useState<string[]>([]);
  const [test, setTest] = useState<{ status: string; checks: { id: string; description: string; ok: boolean; determinate: boolean; explanation?: string }[] } | null>(null);

  const [templateId, setTemplateId] = useState("");
  const applyTemplate = (t: ValidatorTemplate) => {
    setTemplateId(t.id);
    setName(t.name);
    setSlug(t.slug);
    setSlugTouched(true);
    setDescription(t.description);
    setRulesText(pretty(t.rules));
    setSampleText(pretty(t.sample));
    setEvidenceText(t.evidenceTypes.join(", "));
    setParamsText(JSON.stringify(t.taskParameters));
    setTest(null);
    setErrors([]);
  };
  const rules = useMemo(() => parseJson(rulesText), [rulesText]);
  const rulesError = rules.ok ? (Array.isArray(rules.value) ? "" : "Rules must be a JSON array, like [ { ... }, { ... } ].") : rules.error;

  const addSnippet = (rule: object) => {
    const cur = parseJson(rulesText);
    if (!cur.ok || !Array.isArray(cur.value)) return setErrors(["Fix the JSON in the rules box before inserting a rule."]);
    setErrors([]);
    setRulesText(pretty([...cur.value, rule]));
  };

  const fail = (e: unknown) => {
    if (e instanceof ApiClientError) {
      const list = (e.details as { errors?: string[] } | undefined)?.errors;
      setErrors(list?.length ? list : [e.message]);
    } else setErrors([e instanceof Error ? e.message : "Something went wrong."]);
  };

  const runTest = async () => {
    setErrors([]);
    setTest(null);
    const sample = parseJson(sampleText);
    const params = parseJson(paramsText);
    if (!rules.ok || rulesError) return setErrors([rulesError || "Fix the rules JSON first."]);
    if (!sample.ok) return setErrors([`Sample result is not valid JSON: ${sample.error}`]);
    if (!params.ok || typeof params.value !== "object" || params.value === null || Array.isArray(params.value)) return setErrors(["Task parameters must be a JSON object, like { \"minimumResults\": 10 }."]);
    const types = evidenceText.split(/[\s,]+/).filter(Boolean);
    setBusy("test");
    try {
      setTest(await post("/validators/test", { rules: rules.value, result: sample.value, taskParameters: params.value, ...(types.length ? { evidenceTypes: types } : {}) }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    setErrors([]);
    if (!rules.ok || rulesError) return setErrors([rulesError || "Fix the rules JSON first."]);
    if (!existing && (name.trim().length < 1 || slug.length < 3)) return setErrors(["Give the validator a name (the id needs at least 3 characters)."]);
    setBusy("save");
    try {
      if (existing) await patch(`/validators/${existing.slug}`, { name: name.trim(), description: description.trim(), rules: rules.value });
      else await post("/validators", { slug, name: name.trim(), description: description.trim(), rules: rules.value });
      toast(existing ? `Saved as version ${existing.version + 1}` : "Validator created");
      onDone();
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  };

  const box = "width:100%;font-family:'Geist Mono',monospace;font-size:12.5px;line-height:1.6;min-height:200px";
  return (
    <Card pad={24} gap={20}>
      <div style={s("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
        <span style={s("font-size:18px;font-weight:500")}>{existing ? `New version of ${existing.name}` : "New validator"}</span>
        {existing && <Mono color="#7C847F">v{existing.version} → v{existing.version + 1}</Mono>}
      </div>
      <p style={s("margin:0;color:#9BA39E;font-size:13.5px;line-height:1.65;max-width:780px")}>
        Describe what a good result looks like as rules. Verid runs them on its server over the result and evidence, with no code to host. Rules check <b style={{ color: "#E8ECE9", fontWeight: 500 }}>structure and limits</b>, not truth, and every result says the rules were written by your workspace. Versions are immutable: editing creates a new version, and each validation records which one it used.
      </p>

      {!existing && (
        <div style={s("display:flex;flex-direction:column;gap:10px")}>
          <Label>START FROM A TEMPLATE (OPTIONAL)</Label>
          <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:10px")}>
            {VALIDATOR_TEMPLATES.map((t) => (
              <Btn key={t.id} onClick={() => applyTemplate(t)} css={`text-align:left;display:flex;flex-direction:column;gap:4px;padding:12px 14px;border-radius:10px;border:1px solid ${templateId === t.id ? "#2C8A66" : "#252B27"};background:${templateId === t.id ? "#0F1512" : "#0F1210"};color:#E8ECE9;cursor:pointer`} hover="border-color:#303832;background:#131714">
                <span style={s("font-size:13.5px;font-weight:500")}>{t.name}</span>
                <span style={s("font-size:12px;color:#9BA39E;line-height:1.5;font-weight:400")}>{t.fits}</span>
              </Btn>
            ))}
          </div>
          {templateId && <span style={s("font-size:12px;color:#7C847F;line-height:1.55")}>Template loaded: the rules, a sample result that passes, and the evidence it expects. Press <b style={{ color: "#C8D0CB", fontWeight: 500 }}>Run test</b> to see it pass, then change the sample to see it fail.</span>}
        </div>
      )}

      <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:14px")}>
        <label style={s("display:flex;flex-direction:column;gap:6px;font-size:12px;color:#7C847F")}>Name
          <Field value={name} onChange={(e) => { setName(e.target.value); if (!existing && !slugTouched) setSlug(slugify(e.target.value)); }} placeholder="Startup list checker" css={inputCss} />
        </label>
        <label style={s("display:flex;flex-direction:column;gap:6px;font-size:12px;color:#7C847F")}>ID (used in the API as custom:&lt;id&gt;)
          <Field value={slug} disabled={!!existing} onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true); }} placeholder="startup-list-checker" css={inputCss + ";font-family:'Geist Mono',monospace" + (existing ? ";opacity:.6" : "")} />
        </label>
      </div>
      <label style={s("display:flex;flex-direction:column;gap:6px;font-size:12px;color:#7C847F")}>Description (optional)
        <Field value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this validator is for" css={inputCss} />
      </label>

      <div style={s("display:flex;flex-direction:column;gap:10px")}>
        <Label>RULES (JSON)</Label>
        <Area value={rulesText} onChange={(e) => setRulesText(e.target.value)} spellCheck={false} css={inputCss + ";height:auto;padding:12px;" + box} />
        {rulesError && <span style={s("font-size:12.5px;color:#D08A8A")}>{rulesError}</span>}
        <div style={s("display:flex;gap:8px;flex-wrap:wrap;align-items:center")}>
          <span style={s("font-size:12px;color:#7C847F")}>Add a rule:</span>
          {SNIPPETS.map((x) => (
            <span key={x.label} title={x.hint}><Btn onClick={() => addSnippet(x.rule)} css={ghostBtn + ";height:28px;padding:0 10px;font-size:12px"} hover={ghostHover}>{x.label}</Btn></span>
          ))}
        </div>
        <span style={s("font-size:12px;color:#7C847F;line-height:1.55")}>
          Paths: <Mono size={12}>$</Mono> is the whole result, <Mono size={12}>$[*]</Mono> every item of a list, <Mono size={12}>$[*].website</Mono> a field of each item. A missing path is a failure, never a pass.
        </span>
      </div>

      <div style={s("display:flex;flex-direction:column;gap:12px;padding-top:18px;border-top:1px solid #1D221F")}>
        <Label>TRY IT (NOTHING IS SAVED)</Label>
        <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:14px")}>
          <label style={s("display:flex;flex-direction:column;gap:6px;font-size:12px;color:#7C847F")}>Sample result (JSON)
            <Area value={sampleText} onChange={(e) => setSampleText(e.target.value)} spellCheck={false} css={inputCss + ";height:auto;padding:12px;" + box + ";min-height:140px"} />
          </label>
          <div style={s("display:flex;flex-direction:column;gap:14px")}>
            <label style={s("display:flex;flex-direction:column;gap:6px;font-size:12px;color:#7C847F")}>Evidence types recorded (comma-separated, blank for none)
              <Field value={evidenceText} onChange={(e) => setEvidenceText(e.target.value)} css={inputCss + ";font-family:'Geist Mono',monospace;font-size:12.5px"} />
            </label>
            <label style={s("display:flex;flex-direction:column;gap:6px;font-size:12px;color:#7C847F")}>Task parameters (JSON)
              <Field value={paramsText} onChange={(e) => setParamsText(e.target.value)} css={inputCss + ";font-family:'Geist Mono',monospace;font-size:12.5px"} />
            </label>
          </div>
        </div>
        <div><Btn onClick={runTest} disabled={busy !== ""} css={ghostBtn} hover={ghostHover}>{busy === "test" ? <Spinner /> : null} Run test</Btn></div>
        {test && (
          <div style={s("border:1px solid #252B27;border-radius:10px;padding:6px 14px;background:#0F1210")}>
            <div style={s(`padding:10px 0;border-bottom:1px solid #161A18;font-family:${MONO};font-size:12px;letter-spacing:0.08em;color:${test.status === "pass" ? "#4ADE80" : test.status === "fail" ? "#D08A8A" : "#CDB274"}`)}>RESULT: {test.status.toUpperCase()}</div>
            {test.checks.map((c) => (
              <div key={c.id} style={s("display:flex;flex-direction:column;gap:2px;padding:9px 0;border-bottom:1px solid #161A18")}>
                <div style={s("display:flex;gap:10px;align-items:baseline")}>
                  <span style={s(`font-family:${MONO};color:${!c.determinate ? "#CDB274" : c.ok ? "#4ADE80" : "#D08A8A"};width:14px;flex:none`)}>{!c.determinate ? "◷" : c.ok ? "✓" : "✕"}</span>
                  <span style={s("font-size:13px;color:#C8D0CB")}>{c.description}</span>
                </div>
                {c.explanation && !c.ok && <span style={s(`font-family:${MONO};font-size:11.5px;color:#D08A8A;padding-left:24px;overflow-wrap:anywhere`)}>{c.explanation}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <div role="alert" style={s("border:1px solid rgba(166,93,93,0.35);border-radius:10px;background:#140F0F;padding:12px 14px;display:flex;flex-direction:column;gap:4px")}>
          {errors.map((e, i) => <span key={i} style={s("font-size:12.5px;color:#D08A8A;line-height:1.5;overflow-wrap:anywhere")}>{e}</span>)}
        </div>
      )}

      <div style={s("display:flex;gap:10px;flex-wrap:wrap")}>
        <Btn onClick={save} disabled={busy !== ""} css={primaryBtn} hover={primaryHover}>{busy === "save" ? <Spinner /> : null} {existing ? "Save as new version" : "Create validator"}</Btn>
        <Btn onClick={onCancel} disabled={busy !== ""} css={ghostBtn} hover={ghostHover}>Cancel</Btn>
      </div>
    </Card>
  );
}
