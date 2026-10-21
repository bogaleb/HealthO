import { deactivateTemplate } from "@projectos/scheduling";
import { api } from "@/lib/api";

/** Deactivates the working-hours block (kept for history; existing appointments untouched). */
export const DELETE = api<{ id: string }>(async ({ ctx, db, params }) => deactivateTemplate(db, ctx, params.id));
