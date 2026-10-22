import { listComplianceItems } from "@projectos/compliance";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db }) => listComplianceItems(db, ctx));
