import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { databaseUrl } from "./env";

export type Schema = typeof schema;
export type Db = PostgresJsDatabase<Schema>;
/** A database handle or an open transaction. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const globalForDb = globalThis as unknown as { __projectosSql?: postgres.Sql; __projectosDb?: Db };

export function createDb(url = databaseUrl(), max = Number(process.env.DATABASE_POOL_MAX ?? 10)) {
  const sql = postgres(url, { max, onnotice: () => {}, connection: { application_name: "projectos" } });
  return { sql, db: drizzle(sql, { schema }) };
}

/** Process-wide singleton (survives Next.js dev hot reload). */
export function getDb(): Db {
  if (!globalForDb.__projectosDb) {
    const { sql, db } = createDb();
    globalForDb.__projectosSql = sql;
    globalForDb.__projectosDb = db;
  }
  return globalForDb.__projectosDb;
}

export function getSql(): postgres.Sql {
  getDb();
  return globalForDb.__projectosSql!;
}

/** Postgres error helpers */
export function pgErrorCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code ?? err?.cause?.code;
}
export function pgConstraint(e: unknown): string | undefined {
  const err = e as { constraint_name?: string; cause?: { constraint_name?: string } };
  return err?.constraint_name ?? err?.cause?.constraint_name;
}
