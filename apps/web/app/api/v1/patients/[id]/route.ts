import { getPatient } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const GET = api<{ id: string }>(async ({ ctx, db, params }) => getPatient(db, ctx, params.id));
