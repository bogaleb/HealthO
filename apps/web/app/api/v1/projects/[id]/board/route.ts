import { getBoard } from "@projectos/core";
import { api } from "@/lib/api";

export const GET = api<{ id: string }>(async ({ ctx, db, params }) => getBoard(db, ctx, params.id));
