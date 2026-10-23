"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Plug,
  Printer,
  ShieldCheck,
  KeySquare,
  BadgeCheck,
  Bell,
  ChartColumn,
  Inbox,
  LayoutDashboard,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  FolderKanban,
  Grid3X3,
  Home,
  KeyRound,
  Landmark,
  MapPin,
  Scale,
  ScrollText,
  Search,
  ListOrdered,
  Settings2,
  Stethoscope,
  Users,
} from "lucide-react";
import { cn } from "@projectos/ui";

const ICONS = {
  home: Home,
  work: ClipboardList,
  projects: FolderKanban,
  users: Users,
  roles: KeyRound,
  sites: MapPin,
  audit: ScrollText,
  providers: Stethoscope,
  cases: BadgeCheck,
  readiness: Grid3X3,
  payers: Landmark,
  rules: Scale,
  calendar: CalendarDays,
  find: Search,
  book: CalendarPlus,
  setup: Settings2,
  waitlist: ListOrdered,
  queues: Inbox,
  dashboard: LayoutDashboard,
  reports: ChartColumn,
  bell: Bell,
  worker: Activity,
  plug: Plug,
  print: Printer,
  shield: ShieldCheck,
  key: KeySquare,
};
export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  /** Optional count shown after the label (e.g. unread notifications). */
  badge?: number;
}
export interface NavSection {
  title?: string;
  items: NavItem[];
}

export function SideNav({ sections }: { sections: NavSection[] }) {
  const path = usePathname();
  const all = sections.flatMap((s) => s.items.map((i) => i.href));
  const item = (n: NavItem) => {
    const Icon = ICONS[n.icon];
    // Longest matching prefix wins so /credentialing/cases doesn't also highlight /credentialing/readiness.
    const best = all.filter((h) => path === h || (h !== "/home" && path.startsWith(h + "/")) || path === h).sort((a, b) => b.length - a.length)[0];
    const active = best === n.href;
    return (
      <li key={n.href}>
        <Link
          href={n.href}
          // Sidebar links are on every page: auto-prefetching ~12 routes per page load raced with real
          // navigations (aborted prefetch → stalled transition). Fetch on click instead.
          prefetch={false}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group relative flex items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] text-[13.5px] tracking-[-0.005em] transition-[background-color,color,transform] duration-300 [transition-timing-function:var(--ease-spring)] active:scale-[0.98]",
            active
              ? "bg-white/[0.07] font-medium text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset]"
              : "text-slate-300 hover:translate-x-0.5 hover:bg-white/[0.04] hover:text-white",
          )}
        >
          {active && <span aria-hidden className="pearl-bg absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full shadow-[0_0_12px_2px_rgba(195,207,240,0.45)]" />}
          <Icon className={cn("h-4 w-4 shrink-0 transition-colors", active ? "text-[#c3cff0]" : "text-slate-400 group-hover:text-slate-200")} aria-hidden />
          <span className="flex-1">{n.label}</span>
          {n.badge ? (
            <span className="tabular rounded-full bg-[#ffa582] px-1.5 text-[11px] font-semibold text-ink-950 shadow-[0_0_14px_-2px_rgba(255,165,130,0.7)]" data-testid="nav-badge">
              {n.badge}
              <span className="sr-only"> unread</span>
            </span>
          ) : null}
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label="Main" className="relative flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-2">
      {sections
        .filter((s) => s.items.length)
        .map((s, i) => (
          <div key={i}>
            {s.title && <p className="mb-1.5 px-2.5 text-[12px] font-medium text-slate-400">{s.title}</p>}
            <ul className="space-y-0.5">{s.items.map(item)}</ul>
          </div>
        ))}
      <div className="mt-auto rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-[11.5px] leading-snug text-slate-400">
        <p className="font-semibold text-slate-300">Not built yet</p>
        <p className="mt-0.5">Real EHR connection (only a synthetic simulator exists), outbound email/SMS. NOT APPROVED FOR REAL PHI.</p>
      </div>
    </nav>
  );
}
