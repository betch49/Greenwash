import { NextResponse } from "next/server";
import { toRunView } from "@/lib/pipeline/view";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Read-only run status for polling. A GET never starts or changes anything. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getServices().runs.get(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(toRunView(run), { headers: { "cache-control": "no-store" } });
}
