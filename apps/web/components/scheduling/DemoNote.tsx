/** Shown on every scheduling page: synthetic demo, and fixture policies are not law. */
export function SchedulingDemoNote({ bookingEnabled }: { bookingEnabled: boolean }) {
  return (
    <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
      <strong>Synthetic demo scheduling.</strong> Patients are fictional. Eligibility is computed deterministically from verified evidence and compliance-approved rules — the demo
      rules are <strong>DEMO SYNTHETIC POLICY — NOT VERIFIED LAW</strong>. The EHR is not connected.{" "}
      {bookingEnabled
        ? "Booking is enabled only because SCHEDULING_MODE=DEMO_ONLY."
        : "Booking is disabled (set SCHEDULING_MODE=DEMO_ONLY in a synthetic mode to enable the demo)."}
    </p>
  );
}
