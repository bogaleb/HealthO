import { is, sql } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import type { Db } from "./client";
import * as schema from "./schema";

export type SchemaDrift = { missingTables: string[]; missingColumns: string[]; nullabilityMismatches: string[] };

/**
 * Release smoke check (Phase 8): every table and column the application code expects (the Drizzle schema) must
 * exist in the connected database with the same nullability. Extra objects in the database are allowed (a newer
 * migration may add columns before the code uses them — expand/contract). Used after `release:migrate` and the
 * clean-deployment restore drill; a non-empty result means "do not route traffic to this release".
 */
export async function schemaDrift(db: Db): Promise<SchemaDrift> {
  const rows = await db.execute<{ table_name: string; column_name: string; is_nullable: string }>(
    sql`select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public'`,
  );
  const actual = new Map<string, Map<string, boolean>>();
  for (const r of rows) {
    if (!actual.has(r.table_name)) actual.set(r.table_name, new Map());
    actual.get(r.table_name)!.set(r.column_name, r.is_nullable === "YES");
  }
  const drift: SchemaDrift = { missingTables: [], missingColumns: [], nullabilityMismatches: [] };
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value);
    const cols = actual.get(cfg.name);
    if (!cols) {
      drift.missingTables.push(cfg.name);
      continue;
    }
    for (const c of cfg.columns) {
      if (!cols.has(c.name)) drift.missingColumns.push(`${cfg.name}.${c.name}`);
      else if (cols.get(c.name) === c.notNull) drift.nullabilityMismatches.push(`${cfg.name}.${c.name}`);
    }
  }
  return drift;
}

export const driftIsEmpty = (d: SchemaDrift) => !d.missingTables.length && !d.missingColumns.length && !d.nullabilityMismatches.length;
