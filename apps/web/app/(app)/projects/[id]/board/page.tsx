import type { Metadata } from "next";
import { getDb } from "@projectos/db";
import { getBoard, listMemberDirectory } from "@projectos/core";
import { requireContext, load } from "@/lib/session";
import { Board } from "@/components/tasks/Board";

export const metadata: Metadata = { title: "Board" };

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const db = getDb();
  const [board, members] = await Promise.all([load(getBoard(db, ctx, id)), listMemberDirectory(db, ctx)]);
  return <Board projectId={id} initialTasks={board.tasks} canEdit={board.canEdit} members={members} />;
}
