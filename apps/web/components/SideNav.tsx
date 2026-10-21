"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
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
};
export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
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
            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors",
            active ? "bg-white/10 font-medium text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          {n.label}
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {sections
        .filter((s) => s.items.length)
        .map((s, i) => (
          <div key={i}>
            {s.title && <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{s.title}</p>}
            <ul className="space-y-0.5">{s.items.map(item)}</ul>
          </div>
        ))}
      <div className="mt-auto rounded-md border border-white/10 px-2.5 py-2 text-[11.5px] leading-snug text-slate-400">
        <p className="font-semibold text-slate-300">Not built yet</p>
        <p className="mt-0.5">License-aware booking eligibility (Phase 5) and revenue-cycle queues (Phase 6).</p>
      </div>
    </nav>
  );
}
