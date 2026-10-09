/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@verid/server", "@verid/core", "@verid/arc", "@verid/validators"],
  experimental: {
    // Native/WASM-backed or Node-only deps must not be bundled.
    serverComponentsExternalPackages: ["@electric-sql/pglite", "pg"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

// Production-only headers. Next's dev server needs eval and websockets, so the policy would break `next dev`.
//
// The policy keeps everything on this origin except: Google Fonts (CSS and font files) and GitHub's public API (the
// guided tour's sample agent calls it from the browser). `'unsafe-inline'` for scripts is required by Next.js's own
// inline bootstrap scripts (a nonce-based policy needs middleware); it still blocks every external script, plugins,
// framing and base-tag tricks. `form-action` is deliberately NOT set: Chrome applies it to redirects, which would
// break the "Continue with Google" round trip.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.github.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const baseHeaders = nextConfig.headers;
nextConfig.headers = async () => {
  const rules = await baseHeaders();
  if (process.env.NODE_ENV !== "production") return rules;
  return rules.map((r) => ({
    ...r,
    headers: [
      ...r.headers,
      { key: "Content-Security-Policy", value: CSP },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    ],
  }));
};

export default nextConfig;
