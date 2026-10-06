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

export default nextConfig;
