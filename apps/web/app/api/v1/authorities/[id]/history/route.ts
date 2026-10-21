import { listAuthorityHistory } from "@projectos/credentialing";
import { api } from "@/lib/api";

export const GET = api<{ id: string }>(async ({ ctx, db, params }) => listAuthorityHistory(db, ctx, params.id));
