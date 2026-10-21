import type { Metadata } from "next";
import { getDb } from "@projectos/db";
import { hasAny } from "@projectos/auth";
import { bookingEnabled, getSchedulingReference, listWaitlist } from "@projectos/scheduling";
import { todayIn } from "@projectos/shared";
import { PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { Forbidden } from "@/components/Forbidden";
import { SchedulingDemoNote } from "@/components/scheduling/DemoNote";
import { WaitlistBoard } from "@/components/scheduling/Waitlist";

export const metadata: Metadata = { title: "Waitlist" };

export default async function WaitlistPage() {
  const ctx = await requireContext();
  if (!hasAny(ctx, "scheduling.read")) return <Forbidden what="the waitlist" />;
  const db = getDb();
  const [entries, refData] = await Promise.all([load(listWaitlist(db, ctx)), load(getSchedulingReference(db, ctx))]);
  const enabled = bookingEnabled();
  const data = entries.map((e) => ({
    ...e,
    offers: e.offers.map((o) => ({ ...o, startAt: o.startAt.toISOString(), expiresAt: o.expiresAt.toISOString() })),
  }));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Waitlist"
        description="Staff-entered requests. Offers hold an eligible time until they expire and are re-checked when the patient accepts. Nothing is booked automatically and no message is sent."
      />
      <SchedulingDemoNote bookingEnabled={enabled} />
      <WaitlistBoard entries={data as never} refData={refData} canManage={enabled && hasAny(ctx, "scheduling.manage")} today={todayIn("America/New_York")} />
    </div>
  );
}
