import { acceptInvite } from "@projectos/core";
import { getDb } from "@projectos/db";
import { hashUserPassword } from "@projectos/auth/server";
import { publicApi } from "@/lib/api";

export const POST = publicApi(async ({ body }) => acceptInvite(getDb(), await body(), hashUserPassword));
