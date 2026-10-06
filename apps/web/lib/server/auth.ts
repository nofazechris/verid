import { upsertOAuthUser, verifyCredentials } from "@verid/server";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { getDeps } from "./deps";

const isProd = process.env.NODE_ENV === "production";
// Refuse to RUN without a session secret in production. `next build` imports this module to collect page data
// before any secrets exist (CI, or hosts that inject env only at runtime), so the build itself must not fail.
if (isProd && !process.env.NEXTAUTH_SECRET && process.env.NEXT_PHASE !== "phase-production-build") {
  throw new Error("NEXTAUTH_SECRET is required in production (generate with: openssl rand -base64 32)");
}

/**
 * Auth.js (NextAuth v4) configuration.
 *  - Sessions are encrypted JWTs in an httpOnly, SameSite=Lax cookie (Secure over https).
 *  - Passwords are checked by @verid/server (scrypt, per-email rate limiting); there is no
 *    other password endpoint.
 *  - The JWT carries `sessionVersion`; @verid/server rejects it once a password reset bumps
 *    the user's version, so a reset signs out every other device.
 */
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: "/login", error: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        try {
          const user = await verifyCredentials(await getDeps(), credentials.email, credentials.password);
          return user ? { id: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion } : null;
        } catch {
          return null; // includes rate-limit errors: the UI shows one generic failure message
        }
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })]
      : []),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      const p = profile as { email?: string; name?: string; email_verified?: boolean } | undefined;
      if (!p?.email) return false;
      const u = await upsertOAuthUser(await getDeps(), { email: p.email, name: p.name, emailVerified: p.email_verified === true });
      return !!u; // refuse when Google has not verified the address
    },
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "google") {
        const p = profile as { email?: string; name?: string; email_verified?: boolean } | undefined;
        const u = p?.email ? await upsertOAuthUser(await getDeps(), { email: p.email, name: p.name, emailVerified: p.email_verified === true }) : null;
        if (u) {
          token.uid = u.id;
          token.sv = u.sessionVersion;
        }
      } else if (user) {
        token.uid = user.id;
        token.sv = (user as { sessionVersion?: number }).sessionVersion ?? 0;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.sessionVersion = token.sv as number;
      }
      return session;
    },
  },
};
