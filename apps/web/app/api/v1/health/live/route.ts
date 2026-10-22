import { NextResponse } from "next/server";
import { releaseInfo } from "@projectos/shared";

/** Liveness: process is up. No dependencies, no PHI. Reports the release identity for deploy verification. */
export function GET() {
  return NextResponse.json({ status: "ok", service: "projectos-web", release: releaseInfo(), time: new Date().toISOString() });
}
export const dynamic = "force-dynamic";
