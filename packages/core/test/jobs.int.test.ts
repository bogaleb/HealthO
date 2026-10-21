import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { jobs } from "@projectos/db/schema";
import { JOB_HANDLERS, enqueueJob, runDueJobs } from "../src/jobs";
import { testDb } from "./helpers";

const { db, end } = testDb();
afterAll(async () => end());

describe("postgres job queue", () => {
  it("dedupes enqueue by key and runs each job exactly once across concurrent workers", async () => {
    let calls = 0;
    JOB_HANDLERS["test.count"] = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
    };
    const a = await enqueueJob(db, "test.count", "count-1");
    const b = await enqueueJob(db, "test.count", "count-1");
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    await enqueueJob(db, "test.count", "count-2");
    await Promise.all([runDueJobs(db, 5, "w1"), runDueJobs(db, 5, "w2"), runDueJobs(db, 5, "w3")]);
    expect(calls).toBe(2);
  });

  it("retries failures with backoff and dead-letters after max attempts", async () => {
    JOB_HANDLERS["test.fail"] = async () => {
      throw new Error("boom");
    };
    const id = (await enqueueJob(db, "test.fail", "fail-1"))!;
    await db.update(jobs).set({ maxAttempts: 2 }).where(eq(jobs.id, id));
    await runDueJobs(db, 1);
    let [j] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(j!.status).toBe("FAILED");
    expect(j!.runAt.getTime()).toBeGreaterThan(Date.now());
    await db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, id));
    await runDueJobs(db, 1);
    [j] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(j!.status).toBe("DEAD");
    expect(j!.lastError).toBe("boom");
  });
});
