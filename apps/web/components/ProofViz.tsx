// The animated "proof engine" hero visual. Purely decorative CSS animation, so it is kept as a static
// markup block. It has NO container box: the rings, scan and labels float directly on the page
// background and fade out toward the edges with a radial mask, so it blends into the page.
const CHIP = (pos: string, anim: string, chk: string, label: string) =>
  `<div style="position:absolute;${pos};display:flex;align-items:center;gap:8px;padding:7px 12px;border:1px solid rgba(74,222,128,.34);border-radius:999px;background:rgba(10,14,12,.55);font-family:'Geist Mono',monospace;font-size:10.5px;letter-spacing:0.1em;color:#C9D1CC;white-space:nowrap;animation:${anim} 9s ease-in-out infinite"><span style="width:15px;height:15px;border-radius:50%;background:rgba(74,222,128,.14);border:1px solid rgba(74,222,128,.4);color:#4ADE80;font-size:9px;display:grid;place-items:center;animation:${chk} 9s ease-in-out infinite">✓</span>${label}</div>`;

const RING = (delay: string) =>
  `<div style="position:absolute;top:50%;left:50%;width:300px;height:300px;margin:-150px 0 0 -150px;border-radius:50%;border:1px solid rgba(74,222,128,.28);animation:apRingOut 4.5s ease-out infinite ${delay}"></div>`;

const HTML = `<div style="position:relative;min-height:520px">
      <div style="position:absolute;inset:-8% -6%;-webkit-mask-image:radial-gradient(closest-side,#000 55%,transparent 100%);mask-image:radial-gradient(closest-side,#000 55%,transparent 100%)">
        <div style="position:absolute;inset:0;background:radial-gradient(closest-side,rgba(44,138,102,.16),rgba(44,138,102,.05) 55%,transparent 100%)"></div>
        <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(74,222,128,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(74,222,128,.07) 1px,transparent 1px);background-size:46px 46px"></div>
        <div style="position:absolute;top:0;left:30%;width:1px;height:34%;background:linear-gradient(#4ADE80,rgba(74,222,128,0));animation:apDrift 5.5s linear infinite"></div>
        <div style="position:absolute;top:0;left:62%;width:1px;height:30%;background:linear-gradient(#2C8A66,rgba(44,138,102,0));animation:apDrift 7.2s linear infinite 1.4s"></div>
        <div style="position:absolute;top:0;left:78%;width:1px;height:32%;background:linear-gradient(#4ADE80,rgba(74,222,128,0));animation:apDrift 6.3s linear infinite 3s"></div>
        <div style="position:absolute;left:0;right:0;height:110px;background:linear-gradient(rgba(74,222,128,0),rgba(74,222,128,.06) 70%,rgba(74,222,128,.28));animation:apSweepY 4.4s cubic-bezier(.45,0,.55,1) infinite"></div>
      </div>

      <div style="position:absolute;inset:0">
        ${RING("")}${RING("1.5s")}${RING("3s")}

        <div style="position:absolute;top:50%;left:50%;width:252px;height:252px;margin:-126px 0 0 -126px;border-radius:50%;border:1px dashed rgba(74,222,128,.14)"></div>
        <div style="position:absolute;top:50%;left:50%;width:252px;height:252px;margin:-126px 0 0 -126px;border-radius:50%;background:conic-gradient(from 0deg,rgba(74,222,128,0) 0 62%,rgba(74,222,128,.10) 86%,rgba(74,222,128,.55) 99%,rgba(74,222,128,0) 100%);-webkit-mask:radial-gradient(circle,transparent 0 47%,#000 48% 50%,transparent 51%);mask:radial-gradient(circle,transparent 0 47%,#000 48% 50%,transparent 51%);animation:apSpin 4.2s linear infinite"></div>
        <div style="position:absolute;top:50%;left:50%;width:252px;height:252px;margin:-126px 0 0 -126px;animation:apSpin 4.2s linear infinite"><span style="position:absolute;top:-4px;left:50%;width:9px;height:9px;margin-left:-4.5px;border-radius:50%;background:#4ADE80;box-shadow:0 0 14px 3px rgba(74,222,128,.65)"></span></div>

        <div style="position:absolute;top:50%;left:50%;width:104px;height:104px;margin:-52px 0 0 -52px;border-radius:50%;background:radial-gradient(closest-side,rgba(74,222,128,.14),rgba(74,222,128,0) 100%);display:grid;place-items:center;color:#4ADE80;animation:apCore 2.8s ease-in-out infinite">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5 20 6v6c0 5-3.4 8.2-8 9.5-4.6-1.3-8-4.5-8-9.5V6z"></path><path d="m8.6 12.1 2.5 2.5 4.3-4.8"></path></svg>
        </div>

        ${CHIP("top:6%;left:50%;transform:translateX(-50%)", "apLit1", "apChk1", "IDENTITY")}
        ${CHIP("top:50%;right:2%;transform:translateY(-50%)", "apLit2", "apChk2", "POLICY")}
        ${CHIP("bottom:12%;left:50%;transform:translateX(-50%)", "apLit3", "apChk3", "EVIDENCE")}
        ${CHIP("top:50%;left:2%;transform:translateY(-50%)", "apLit4", "apChk4", "SIGNATURE")}

        <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;white-space:nowrap">
          <span style="display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 11px;border-radius:7px;font-family:'Geist Mono',monospace;font-size:11px;letter-spacing:0.1em;font-weight:500;color:#4ADE80;background:rgba(74,222,128,0.07);border:1px solid rgba(74,222,128,0.24);animation:apSeal 9s ease-in-out infinite">✓ PROOF SEALED</span>
          <span style="font-family:'Geist Mono',monospace;font-size:11px;color:#5B635E">illustration · not a live proof</span>
        </div>
      </div>
    </div>`;

export default function ProofViz() {
  return <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: HTML }} />;
}
