import { cancelException } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const DELETE = api<{ id: string }>(async ({ ctx, db, params }) => cancelException(db, ctx, params.id));
