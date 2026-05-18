import { isAuthenticated } from "@/lib/auth";

const WS_HTTP = `http://127.0.0.1:${process.env.WS_PORT || 4000}`;
const SECRET = process.env.SESSION_SECRET || "dev-only-change-me";

type Params = { params: Promise<{ id: string; pm2Id: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!(await isAuthenticated())) return new Response("unauthorized", { status: 401 });
  const { id, pm2Id } = await params;
  const upstream = await fetch(`${WS_HTTP}/logs/${id}/${pm2Id}`, {
    headers: { "x-internal-secret": SECRET },
    signal: (req as any).signal,
  });
  if (!upstream.ok || !upstream.body) {
    return new Response(`agent offline (${upstream.status})`, { status: upstream.status });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
