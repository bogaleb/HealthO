import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@projectos/db";
import { hasAny } from "@projectos/auth";
import { bookingEnabled, getHold, getPatient, getSchedulingReference } from "@projectos/scheduling";
import { isAppError, todayIn, US_JURISDICTIONS } from "@projectos/shared";
import { ErrorState, PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { Forbidden } from "@/components/Forbidden";
import { NewAppointmentForm } from "@/components/scheduling/NewAppointmentForm";
import { SchedulingDemoNote } from "@/components/scheduling/DemoNote";

export const metadata: Metadata = { title: "New appointment" };

export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  if (!hasAny(ctx, "scheduling.manage")) return <Forbidden what="booking appointments" />;
  const sp = await searchParams;
  const db = getDb();
  const enabled = bookingEnabled();
  if (!enabled)
    return (
      <div className="space-y-4">
        <PageHeader title="New appointment" />
        <SchedulingDemoNote bookingEnabled={false} />
      </div>
    );
  const refData = await load(getSchedulingReference(db, ctx));
  let hold = null;
  let holdError: string | null = null;
  if (sp.hold) {
    try {
      const h = await getHold(db, ctx, sp.hold);
      hold = {
        ...h,
        startAt: h.startAt.toISOString(),
        endAt: h.endAt.toISOString(),
        expiresAt: h.expiresAt.toISOString(),
        modality: h.modality as "IN_PERSON" | "VIDEO" | "AUDIO_ONLY",
      };
    } catch (e) {
      if (!isAppError(e)) throw e;
      holdError = "That hold no longer exists. Search again.";
    }
  }
  let patient = null;
  if (sp.patient) patient = await getPatient(db, ctx, sp.patient).catch(() => null);
  const state = US_JURISDICTIONS.includes(sp.state as never) ? sp.state : undefined;
  return (
    <div className="space-y-4">
      <PageHeader
        title="New appointment"
        description={
          hold ? (
            "Book the time you are holding."
          ) : (
            <>
              Enter a time directly, or{" "}
              <Link href="/scheduling/find" className="text-teal-800 underline">
                find and hold an open time
              </Link>{" "}
              first (recommended).
            </>
          )
        }
      />
      <SchedulingDemoNote bookingEnabled={enabled} />
      {holdError ? (
        <ErrorState title="Hold not found" message={holdError} />
      ) : (
        <NewAppointmentForm refData={refData} hold={hold} initialState={state} initialPatient={patient} initialPlan={sp.plan} today={todayIn("America/New_York")} />
      )}
    </div>
  );
}
