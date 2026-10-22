import { workerStatus } from "@projectos/notifications";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db }) => workerStatus(db, ctx));
