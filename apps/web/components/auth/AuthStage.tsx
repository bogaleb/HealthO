import type { ReactNode } from "react";
import { CircleCheck, ShieldCheck, Clock3, RefreshCw } from "lucide-react";

/**
 * The ink stage used by sign-in, two-step verification, invitation and no-access screens.
 * Signature moment (sign-in only): the headline rises line by line and a "clinic day" rail draws across the stage,
 * with the day's checks popping onto it — the product's promise (nothing is booked that can't be verified) told as
 * a picture of one day. Pure CSS motion; collapses to a static frame under reduced motion.
 */
export function AuthStage({ children, hero = false }: { children: ReactNode; hero?: boolean }) {
  return (
    <main className="grain relative isolate flex min-h-dvh overflow-hidden bg-ink-950 text-white">
      {/* Aura: two soft light sources drifting very slowly behind everything. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="aura absolute -left-[12%] top-[8%] h-[46rem] w-[46rem] rounded-full bg-[radial-gradient(circle_at_center,rgba(195,207,240,0.22),transparent_62%)] blur-2xl" />
        <div
          className="aura absolute -right-[10%] bottom-[-18%] h-[40rem] w-[40rem] rounded-full bg-[radial-gradient(circle_at_center,rgba(246,227,214,0.16),transparent_60%)] blur-2xl"
          style={{ animationDelay: "-9s" }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:88px_100%] [mask-image:linear-gradient(180deg,transparent,black_30%,black_70%,transparent)]" />
      </div>
      <div
        className={`mx-auto grid w-full max-w-[1240px] items-center gap-12 px-5 py-10 md:px-10 ${hero ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,440px)]" : "place-items-center"}`}
      >
        {hero && <Hero />}
        <div className="w-full max-w-md justify-self-center lg:justify-self-end">{children}</div>
      </div>
    </main>
  );
}

function Hero() {
  return (
    <section aria-labelledby="stage-title" className="min-w-0">
      <div className="reveal-mask">
        <div className="reveal-line flex items-center gap-2.5">
          <span aria-hidden className="pearl-bg grid h-8 w-8 place-items-center rounded-[10px] shadow-[0_8px_24px_-8px_rgba(195,207,240,0.6)]">
            <span className="h-2.5 w-2.5 rounded-full bg-ink-950/85" />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-white">ProjectOS Health</span>
        </div>
      </div>
      <h2 id="stage-title" className="display-title-on-ink mt-10 text-[44px] font-[300] leading-[1.02] tracking-[-0.035em] text-[#f5f5f5] md:text-[64px]">
        <span className="reveal-mask">
          <span className="reveal-line" style={{ ["--i" as string]: 1 }}>
            Every clinic day,
          </span>
        </span>
        <span className="reveal-mask">
          <span className="reveal-line" style={{ ["--i" as string]: 2 }}>
            checked before
          </span>
        </span>
        <span className="reveal-mask">
          <span className="reveal-line" style={{ ["--i" as string]: 3 }}>
            it&apos;s booked.
          </span>
        </span>
      </h2>
      <div className="reveal-mask mt-6">
        <p className="reveal-line max-w-[34rem] text-[16px] leading-relaxed text-slate-300" style={{ ["--i" as string]: 4 }}>
          Scheduling, credentialing, revenue-cycle follow-up and projects in one workspace. A visit is only offered when the license, the payer enrollment and the patient&apos;s
          location all check out.
        </p>
      </div>
      <ClinicDayRail />
    </section>
  );
}

const HOURS = ["8:00", "10:00", "12:00", "14:00", "16:00"];
const TICKS = [8, 17, 24, 35, 46, 52, 61, 70, 79, 88];
const CHIPS = [
  { at: 12, icon: ShieldCheck, title: "Video visit, patient in VA", note: "License verified" },
  { at: 44, icon: RefreshCw, title: "EHR confirmed", note: "Write-through accepted" },
  { at: 76, icon: Clock3, title: "Payer enrollment pending", note: "Held for review" },
];

function ClinicDayRail() {
  return (
    <div aria-hidden className="relative mt-14 hidden max-w-[640px] select-none md:block">
      <div className="relative h-36">
        {CHIPS.map((c, i) => (
          <div key={c.title} className="rise absolute bottom-10 -translate-x-1/2" style={{ left: `${c.at}%`, ["--i" as string]: i, ["--d" as string]: "900ms" }}>
            <div className="w-max rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.8)] backdrop-blur-md">
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-white">
                <c.icon className="h-3.5 w-3.5 text-[#c3cff0]" />
                {c.title}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-slate-400">
                <CircleCheck className="h-3 w-3 text-[#f6e3d6]" />
                {c.note}
              </div>
            </div>
            <div className="mx-auto h-6 w-px bg-gradient-to-b from-white/25 to-transparent" />
          </div>
        ))}
        <div className="absolute inset-x-0 bottom-4">
          <div className="rule-draw rule-pearl opacity-80" style={{ ["--d" as string]: "450ms" }} />
          {TICKS.map((t, i) => (
            <span
              key={t}
              className="tick-pop absolute top-0 h-2 w-2 rounded-full bg-[#f6e3d6] shadow-[0_0_10px_2px_rgba(246,227,214,0.45)]"
              style={{ left: `${t}%`, ["--i" as string]: i }}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-between text-[11.5px] tabular-nums text-slate-500">
        {HOURS.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
    </div>
  );
}

/** Frosted card that sits on the ink stage and holds a light, high-contrast form. */
export function StageCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="rise relative rounded-[22px] bg-white/[0.06] p-1.5 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] ring-1 ring-white/10 backdrop-blur-xl"
      style={{ ["--d" as string]: "200ms" }}
    >
      <div className="rounded-[18px] bg-white p-7 text-slate-900">{children}</div>
    </div>
  );
}
