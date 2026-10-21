import { declineWaitlistOffer } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const POST = api<{ offerId: string }>(async ({ ctx, db, params }) => declineWaitlistOffer(db, ctx, params.offerId));
