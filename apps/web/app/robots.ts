import type { MetadataRoute } from "next";

// Read the host at request time (it is not known when the container is built).
export const dynamic = "force-dynamic";

/** Public pages may be indexed; the dashboard, the API and individual proof pages may not. */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/+$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/docs", "/terms", "/privacy", "/proof/verify"],
        disallow: [
          "/api/",
          "/proof/",
          "/overview",
          "/get-started",
          "/agents",
          "/executions",
          "/receipts",
          "/settlements",
          "/validators",
          "/policies",
          "/settings",
          "/verify",
          "/onboarding",
          "/login",
          "/signup",
          "/forgot-password",
          "/reset-password",
          "/verify-email",
        ],
      },
    ],
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}
