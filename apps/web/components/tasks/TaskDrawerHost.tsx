"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TaskDrawer } from "./TaskDrawer";

/** Opens the task drawer from the `?task=<id>` query param so drawer state survives reload and the back button. */
export function TaskDrawerHost({ members }: { members: { userId: string; displayName: string }[] }) {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const taskId = sp.get("task");
  const setTask = (id: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (id) next.set("task", id);
    else next.delete("task");
    const qs = next.toString();
    router.push(qs ? `${path}?${qs}` : path, { scroll: false });
  };
  return <TaskDrawer taskId={taskId} members={members} onClose={() => setTask(null)} onOpenTask={(id) => setTask(id)} onChanged={() => router.refresh()} />;
}
