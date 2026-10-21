import { getTableName, sql, type Column } from "drizzle-orm";

/**
 * Fully-qualified column reference ("table"."column") for correlated subqueries.
 * Drizzle renders `${col}` UNqualified in single-table selects, which makes Postgres bind the
 * name to the inner subquery's table (e.g. `a.practitioner_id = "id"` → a.id). Always use this
 * when referencing an outer column from inside a raw subquery.
 */
export function qualified(column: Column) {
  return sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
}
