import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@projectos/auth/server";

const handler = () => toNextJsHandler(getAuth());
export const GET = (req: Request) => handler().GET(req);
export const POST = (req: Request) => handler().POST(req);
