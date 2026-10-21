import { acceptWaitlistOffer } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const POST = api<{ offerId: string }>(async ({ ctx, db, params }) => acceptWaitlistOffer(db, ctx, params.offerId));
