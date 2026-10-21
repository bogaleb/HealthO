import { getSchedulingReference } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db }) => getSchedulingReference(db, ctx));
