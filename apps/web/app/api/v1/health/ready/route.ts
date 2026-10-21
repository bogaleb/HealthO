import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@projectos/db";
import { appMode } from "@projectos/shared";

/** Readiness: bounded DB round-trip + migrations applied. */
export async function GET() {
  const started = Date.now();
  try {
    const db = getDb();
    const check = Promise.all([
      db.execute(sql`select 1 as ok`),
      db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`),
    ]);
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000));
    const [, migrations] = await Promise.race([check, timeout]);
    return NextResponse.json({ status: "ready", mode: appMode(), checks: { database: "ok", migrationsApplied: migrations[0]?.n ?? 0 }, ms: Date.now() - started });
  } catch {
    return NextResponse.json({ status: "not_ready", checks: { database: "unavailable" }, ms: Date.now() - started }, { status: 503 });
  }
}
export const dynamic = "force-dynamic";
