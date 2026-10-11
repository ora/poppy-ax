import { checkResult } from "@/lib/check-route";

// Waits for the saved result of a check whose progress stream has closed.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  return checkResult(request, domain);
}
