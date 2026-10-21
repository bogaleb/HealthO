import { Badge } from "@projectos/ui";

/** Eligibility before the Phase 5 policy engine: always "policy pending", never "eligible". */
export function PolicyPendingBadge() {
  return (
    <Badge tone="amber" className="whitespace-nowrap">
      <span title="License-aware eligibility is not evaluated yet (Phase 5). Synthetic demo only.">Eligibility: policy pending</span>
    </Badge>
  );
}

export function SchedulingDemoNote({ bookingEnabled }: { bookingEnabled: boolean }) {
  return (
    <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
      <strong>Synthetic demo scheduling.</strong> Patients are fictional. License-aware eligibility is <strong>not evaluated yet</strong> (policy pending — Phase 5), so nothing
      here means a provider is legally eligible.{" "}
      {bookingEnabled
        ? "Booking is enabled only because SCHEDULING_MODE=DEMO_ONLY."
        : "Booking is disabled (set SCHEDULING_MODE=DEMO_ONLY in a synthetic mode to enable the demo)."}
    </p>
  );
}
