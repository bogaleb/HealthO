import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@projectos/db";
import { organizations } from "@projectos/db/schema";
import { hasAny } from "@projectos/auth";
import { appMode, isSyntheticMode } from "@projectos/shared";
import { requireContext } from "@/lib/session";
import { SideNav, type NavItem } from "@/components/SideNav";
import { SignOutButton } from "@/components/SignOutButton";
import { unreadCount } from "@projectos/notifications";
import { canSeeReports } from "@projectos/reports";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const [org] = await getDb().select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.organizationId));
  const mode = appMode();
  const banner = isSyntheticMode(mode);
  const main: NavItem[] = [{ href: "/home", label: "Home", icon: "home" }];
  if (hasAny(ctx, "projects.read")) main.push({ href: "/tasks/my-work", label: "My Work", icon: "work" }, { href: "/projects", label: "Projects", icon: "projects" });
  const admin: NavItem[] = [];
  if (hasAny(ctx, "users.manage")) admin.push({ href: "/admin/users", label: "Staff & Permissions", icon: "users" });
  if (hasAny(ctx, "users.manage") || hasAny(ctx, "org.manage")) admin.push({ href: "/admin/roles", label: "Roles", icon: "roles" });
  admin.push({ href: "/admin/sites", label: "Sites & Departments", icon: "sites" });
  if (hasAny(ctx, "credentialing.read") || hasAny(ctx, "policy.publish")) admin.push({ href: "/admin/rules", label: "License Policy Rules", icon: "rules" });
  const cred: NavItem[] = hasAny(ctx, "credentialing.read")
    ? [
        { href: "/providers", label: "Providers", icon: "providers" },
        { href: "/credentialing/cases", label: "Credentialing Cases", icon: "cases" },
        { href: "/credentialing/readiness", label: "Readiness Matrix", icon: "readiness" },
        { href: "/credentialing/payers", label: "Payers & Plans", icon: "payers" },
      ]
    : [];
  const sched: NavItem[] = hasAny(ctx, "scheduling.read")
    ? [
        { href: "/scheduling/calendar", label: "Schedule", icon: "calendar" },
        { href: "/scheduling/find", label: "Find Appointment", icon: "find" },
        ...(hasAny(ctx, "scheduling.manage") ? [{ href: "/scheduling/appointments/new", label: "New Appointment", icon: "book" } as NavItem] : []),
        { href: "/scheduling/waitlist", label: "Waitlist", icon: "waitlist" },
        { href: "/scheduling/setup", label: "Scheduling Setup", icon: "setup" },
      ]
    : [];
  if (hasAny(ctx, "audit.read")) admin.push({ href: "/admin/audit", label: "Audit Log", icon: "audit" });
  if (hasAny(ctx, "org.manage")) admin.push({ href: "/admin/worker", label: "Worker & Outbox", icon: "worker" });
  const rcm: NavItem[] = hasAny(ctx, "rcm.read") ? [{ href: "/rcm/queues", label: "Work Queues", icon: "queues" }] : [];
  const insights: NavItem[] = canSeeReports(ctx)
    ? [
        { href: "/dashboard", label: "Operations Dashboard", icon: "dashboard" },
        { href: "/reports", label: "Reports", icon: "reports" },
      ]
    : [];
  main.push({ href: "/notifications", label: "Notifications", icon: "bell", badge: await unreadCount(getDb(), ctx) });

  return (
    <div className="flex min-h-dvh flex-col">
      {banner && (
        <div role="note" className="sticky top-0 z-30 flex h-7 items-center justify-center truncate bg-amber-400 px-4 text-center text-[12.5px] font-semibold text-amber-950">
          SYNTHETIC DEMO DATA · {mode} mode · Do not enter real patient information (PHI). Not approved for clinical use.
        </div>
      )}
      <div className="flex flex-1">
        <aside className={`sticky hidden w-60 shrink-0 flex-col bg-navy-950 md:flex ${banner ? "top-7 h-[calc(100dvh-1.75rem)]" : "top-0 h-dvh"}`}>
          <div className="border-b border-white/10 px-4 py-3.5">
            <div className="text-[15px] font-semibold tracking-tight text-white">ProjectOS Health</div>
            <div className="mt-0.5 truncate text-[12px] text-slate-400" title={org?.name}>
              {org?.name}
            </div>
          </div>
          <SideNav
            sections={[
              { items: main },
              { title: "Insights", items: insights },
              { title: "Scheduling", items: sched },
              { title: "Credentialing", items: cred },
              { title: "Revenue cycle", items: rcm },
              { title: "Administration", items: admin },
            ]}
          />
          <div className="border-t border-white/10 px-3 py-3">
            <div className="truncate px-1 text-[13px] text-slate-200">{ctx.displayName}</div>
            <div className="mt-1.5">
              <SignOutButton compact />
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 md:hidden">
            <span className="font-semibold">ProjectOS Health</span>
            <SignOutButton />
          </header>
          <nav aria-label="Mobile" className="flex gap-3 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 text-sm md:hidden">
            {[...main, ...insights, ...sched, ...cred, ...rcm, ...admin].map((n) => (
              <a key={n.href} href={n.href} className="whitespace-nowrap text-slate-700">
                {n.label}
              </a>
            ))}
          </nav>
          <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8">
            {children}
            {/* Changes on every server render; lets clients confirm a router.refresh() was committed. */}
            <span hidden data-render-stamp={randomUUID()} />
          </main>
        </div>
      </div>
    </div>
  );
}
