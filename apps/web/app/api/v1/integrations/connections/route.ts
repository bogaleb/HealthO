import { z } from "zod";
import { connectSimulator } from "@projectos/integrations";
import { parse } from "@projectos/core";
import { api } from "@/lib/api";

/** Connect a site to the SYNTHETIC EHR simulator (real vendors need verified access first — not available here). */
export const POST = api(
  async ({ ctx, db, body }) => {
    const { siteId } = parse(z.object({ siteId: z.uuid() }), await body());
    return connectSimulator(db, ctx, siteId);
  },
  { status: 201 },
);
