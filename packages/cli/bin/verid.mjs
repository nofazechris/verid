#!/usr/bin/env node
// Dev entrypoint: runs the TypeScript source through tsx. A bundled, published
// build (tsup) replaces this before the package is released.
import { register } from "tsx/esm/api";

register();
const { main } = await import("../src/index.ts");
const code = await main(
  process.argv.slice(2),
  { out: (s) => console.log(s), err: (s) => console.error(s) },
);
process.exit(code);
