import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

const PATHS = [
  "/",
  "/docs",
  "/docs/overview",
  "/docs/build-and-ship",
  "/docs/examples",
  "/docs/integrate",
  "/docs/sdk",
  "/docs/agents",
  "/docs/validators",
  "/docs/escrow",
  "/docs/verification",
  "/docs/trust-model",
  "/docs/api",
  "/proof/verify",
  "/terms",
  "/privacy",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/+$/, "");
  if (!base) return []; // no public address configured yet: better an empty sitemap than wrong URLs
  return PATHS.map((p) => ({ url: base + p }));
}
