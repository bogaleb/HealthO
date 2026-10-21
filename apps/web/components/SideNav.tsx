"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, FolderKanban, Home, KeyRound, MapPin, ScrollText, Users } from "lucide-react";
import { cn } from "@projectos/ui";

export interface NavItem {
  href: string;
  label: string;
  icon: "home" | "work" | "projects" | "users" | "roles" | "sites" | "audit";
}
const ICONS = { home: Home, work: ClipboardList, projects: FolderKanban, users: Users, roles: KeyRound, sites: MapPin, audit: ScrollText };

export function SideNav({ main, admin }: { main: NavItem[]; admin: NavItem[] }) {
  const path = usePathname();
  const item = (n: NavItem) => {
    const Icon = ICONS[n.icon];
    const active = path === n.href || (n.href !== "/home" && path.startsWith(n.href));
    return (
      <li key={n.href}>
        <Link
          href={n.href}
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
      <ul className="space-y-0.5">{main.map(item)}</ul>
      {admin.length > 0 && (
        <div>
          <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Administration</p>
          <ul className="space-y-0.5">{admin.map(item)}</ul>
        </div>
      )}
      <div className="mt-auto rounded-md border border-white/10 px-2.5 py-2 text-[11.5px] leading-snug text-slate-400">
        <p className="font-semibold text-slate-300">Not built yet</p>
        <p className="mt-0.5">Scheduling, credentialing &amp; licensure eligibility, and revenue-cycle queues arrive in Phases 3–6.</p>
      </div>
    </nav>
  );
}
