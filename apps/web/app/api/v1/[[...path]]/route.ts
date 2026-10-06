import { createApi } from "@verid/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/server/auth";
import { getDeps } from "@/lib/server/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Anchoring and settlement wait for chain confirmations (see VERID_CONFIRMATION_TIMEOUT_MS). Platforms that honour this
// (e.g. Vercel) are told the route may run up to a minute; a slow chain returns "pending" instead of failing.
export const maxDuration = 60;

let handler: ((req: Request) => Promise<Response>) | undefined;

async function handle(req: Request): Promise<Response> {
  if (!handler) {
    const deps = await getDeps();
    handler = createApi({
      ...deps,
      // Cookie sessions come from Auth.js. API keys never touch this.
      sessions: async () => {
        const s = await getServerSession(authOptions);
        return s?.user?.id ? { userId: s.user.id, sessionVersion: s.user.sessionVersion } : null;
      },
    });
  }
  return handler(req);
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
