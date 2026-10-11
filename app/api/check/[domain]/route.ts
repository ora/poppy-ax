import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { startCheck } from "@/lib/check-route";

// Starts a check, relays its progress to the browser as server-sent events,
// then waits on the server for the saved result. POST, so no link, prefetch
// or crawler starts a check by visiting.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Ora's stream can run up to about 5 minutes, then the result wait takes up
// to 30 seconds.
export const maxDuration = 330;

export async function POST(request: Request, { params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  return startCheck(request, domain, {
    // Next applies a route's cache expiries when its handler returns, which
    // for a stream is before the result is known. `after` runs once the
    // stream has closed, inside the request, where an expiry still applies.
    scheduleRevalidate: (tag) =>
      after(async () => {
        const value = await tag;
        if (value) revalidateTag(value, { expire: 0 });
      }),
  });
}
