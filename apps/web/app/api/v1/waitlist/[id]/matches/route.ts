import { matchingSlots } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const GET = api<{ id: string }>(async ({ ctx, db, params }) => matchingSlots(db, ctx, params.id));
