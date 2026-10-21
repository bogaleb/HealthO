"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@projectos/ui";

export function ProjectTabs({ projectId }: { projectId: string }) {
  const path = usePathname();
  const tabs = [
    { href: `/projects/${projectId}`, label: "Overview" },
    { href: `/projects/${projectId}/board`, label: "Board" },
    { href: `/projects/${projectId}/list`, label: "List" },
    { href: `/projects/${projectId}/calendar`, label: "Calendar" },
  ];
  return (
    <nav aria-label="Project views" className="mb-5 flex gap-1 border-b border-slate-200">
      {tabs.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium",
              active ? "border-teal-700 text-teal-800" : "border-transparent text-slate-600 hover:text-slate-900",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
