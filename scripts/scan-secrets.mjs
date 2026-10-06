#!/usr/bin/env node
/**
 * Scan everything that WOULD be committed (tracked files plus untracked files that are not git-ignored) for secrets.
 * Run it before your first commit and before every push:
 *
 *   node scripts/scan-secrets.mjs
 *
 * Prints file:line and the kind of secret, never the value. Exits 1 if anything is found.
 * It is a safety net, not a guarantee: it looks for well-known key shapes and obvious secret assignments.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  .toString()
  .split("\0")
  .filter(Boolean);

const RULES = [
  ["Neon database password", /\bnpg_[A-Za-z0-9]{8,}\b/],
  ["Postgres URL with a real password", /postgres(?:ql)?:\/\/[^:\s/@]+:(?!pass(?:word)?@|\*+@|xxx|\.\.\.|<)[^@\s'"`]{8,}@/i],
  ["Google OAuth client secret", /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/],
  ["Resend API key", /\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{12,}\b/],
  ["Verid API key", /\bverid_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{43}\b/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["OpenAI-style secret key", /\bsk-[A-Za-z0-9]{32,}\b/],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["PEM private key", /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ["Private key assigned to a variable", /(?:PRIVATE_KEY|SECRET_KEY|PRIVATE)\w*\s*[=:]\s*["']?0x[0-9a-fA-F]{64}\b/],
];
// Documentation/test placeholders that look like keys but are not.
const ALLOW = [/verid_xxxxxxxx_/i, /verid_AbCdEfGh_/, /verid_x{8}_/i, /verid_<8>_<43>/];
const SKIP_EXT = /\.(png|jpe?g|gif|ico|woff2?|ttf|tgz|gz|zip|pdf|lock|svg)$/i;
const SKIP_PATH = /(^|\/)(pnpm-lock\.yaml|node_modules|\.next|contracts\/(lib|out|cache|broadcast))\//;

const findings = [];
for (const f of files) {
  if (SKIP_EXT.test(f) || SKIP_PATH.test(f) || f === "pnpm-lock.yaml") continue;
  let text;
  try {
    if (statSync(resolve(root, f)).size > 2_000_000) continue;
    text = readFileSync(resolve(root, f), "utf8");
  } catch {
    continue;
  }
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [kind, re] of RULES) {
      if (re.test(line) && !ALLOW.some((a) => a.test(line))) findings.push({ f, line: i + 1, kind });
    }
  });
}

if (!findings.length) {
  console.log(`✓ No secrets found in ${files.length} files that would be committed.`);
  process.exit(0);
}
console.error(`✕ ${findings.length} possible secret(s) in files that would be committed:\n`);
for (const x of findings) console.error(`  ${x.f}:${x.line}  ${x.kind}`);
console.error("\nRemove them (use environment variables), and rotate any real secret that was ever in a file.");
process.exit(1);
