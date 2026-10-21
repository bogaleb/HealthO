import type { Metadata } from "next";
import { getDb } from "@projectos/db";
import { hasAny } from "@projectos/auth";
import { bookingEnabled, getSchedulingReference } from "@projectos/scheduling";
import { todayIn } from "@projectos/shared";
import { PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { Forbidden } from "@/components/Forbidden";
import { FindAppointment } from "@/components/scheduling/FindAppointment";
import { SchedulingDemoNote } from "@/components/scheduling/DemoNote";

export const metadata: Metadata = { title: "Find appointment" };

export default async function FindPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  if (!hasAny(ctx, "scheduling.read")) return <Forbidden what="scheduling" />;
  const sp = await searchParams;
  const refData = await load(getSchedulingReference(getDb(), ctx));
  const enabled = bookingEnabled();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Find appointment"
        description="Server-side search across working hours, time off, closures, rooms and existing bookings (incl. buffers). Hold a time, then book it for a patient."
      />
      <SchedulingDemoNote bookingEnabled={enabled} />
      <FindAppointment refData={refData} today={todayIn("America/New_York")} canBook={enabled && hasAny(ctx, "scheduling.manage")} patientId={sp.patient} />
    </div>
  );
}
