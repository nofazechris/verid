// Publishes the developer assets from this repository through the running app, so a developer can use them with
// nothing but their Verid server's address (no npm account, no git clone):
//
//   curl -O https://<host>/examples/github-research.mjs      runnable examples (single files)
//   npm install https://<host>/sdk/verid-sdk.tgz              the TypeScript SDK, built and packed here
//
// The files under /examples and /packages/sdk stay the single source of truth; public/examples and public/sdk are
// generated copies (git-ignored).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const pub = resolve(here, "../public");

// ---- examples
const ex = resolve(pub, "examples");
mkdirSync(ex, { recursive: true });
const examples = [
  ["examples/github-research/run.mjs", "github-research.mjs"],
  ["examples/github-research/run.py", "github-research.py"],
];
for (const [src, name] of examples) copyFileSync(resolve(root, src), resolve(ex, name));

// ---- research agent (deployable service): copied as plain files
const agentSrc = resolve(root, "examples/research-agent-service");
if (existsSync(agentSrc)) {
  const out = resolve(ex, "research-agent");
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(agentSrc)) {
    if (f === "node_modules") continue;
    copyFileSync(resolve(agentSrc, f), resolve(out, f));
  }
}

// ---- SDK: build, pack, publish as a stable name plus a versioned one
const sdkDir = resolve(root, "packages/sdk");
const sdkOut = resolve(pub, "sdk");
mkdirSync(sdkOut, { recursive: true });
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
rmSync(resolve(sdkDir, "dist"), { recursive: true, force: true });
run("pnpm build", sdkDir);
const tgz = run(`npm pack --silent --pack-destination "${sdkOut}"`, sdkDir).split(/\r?\n/).pop();
copyFileSync(resolve(sdkOut, tgz), resolve(sdkOut, "verid-sdk.tgz"));
const pyClient = resolve(root, "packages/sdk-python/verid.py");
if (existsSync(pyClient)) copyFileSync(pyClient, resolve(sdkOut, "verid.py"));
const version = JSON.parse(readFileSync(resolve(sdkDir, "package.json"), "utf8")).version;
console.log(`synced assets -> public (examples, sdk ${version})`);
