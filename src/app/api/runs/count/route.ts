import { NextResponse } from "next/server";
import { getServices, isOffline } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Test-only: number of rows in `runs`. Available only in offline fixture mode. */
export function GET() {
  if (!isOffline() && process.env.GR_TEST_ROUTES !== "1") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ count: getServices().runs.count() });
}
