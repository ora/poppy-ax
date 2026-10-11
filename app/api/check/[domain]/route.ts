import { startCheck } from "@/lib/check-route";

// Starts a check and relays its progress to the browser as server-sent
// events. POST, so no link, prefetch or crawler starts a check by visiting.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  return startCheck(request, domain);
}
