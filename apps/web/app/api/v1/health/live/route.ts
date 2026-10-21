import { NextResponse } from "next/server";

/** Liveness: process is up. No dependencies, no PHI. */
export function GET() {
  return NextResponse.json({ status: "ok", service: "projectos-web", time: new Date().toISOString() });
}
export const dynamic = "force-dynamic";
