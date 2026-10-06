import type { CSSProperties } from "react";

// Parse an inline-CSS string (the format the original design authored) into a
// React style object. Kept as a helper so the ported markup can keep the exact
// style strings from the source as template literals — faithful and low-risk.
const cache = new Map<string, CSSProperties>();

function kebabToCamel(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

// React warns when a style object mixes the `border` shorthand with a
// `border-color` longhand (common here: base uses `border:1px solid X`, hover
// overrides `border-color`). Expand the shorthand to longhands to avoid it.
function normalizeBorder(css: string): string {
  if (!/(^|;)\s*border\s*:/.test(css)) return css;
  return css.replace(/(^|;)(\s*)border\s*:\s*([^;]+)/, (_m, pre, ws, val) => {
    const parts = String(val).trim().split(/\s+/);
    const width = parts[0] || "0";
    const style = parts[1] || "solid";
    const color = parts.slice(2).join(" ") || "currentColor";
    return `${pre}${ws}border-width:${width};border-style:${style};border-color:${color}`;
  });
}

export function s(input: string): CSSProperties {
  const hit = cache.get(input);
  if (hit) return hit;
  const css = normalizeBorder(input);
  const out: Record<string, string> = {};
  for (const decl of css.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    if (!prop) continue;
    const val = decl.slice(i + 1).trim();
    out[prop.startsWith("--") ? prop : kebabToCamel(prop)] = val;
  }
  const frozen = out as CSSProperties;
  cache.set(input, frozen);
  return frozen;
}
