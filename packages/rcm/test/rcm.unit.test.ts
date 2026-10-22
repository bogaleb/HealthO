import { describe, expect, it } from "vitest";
import { AGE_BUCKET_RANGE, RCM_AGE_BUCKETS, SYNTHETIC_CLAIM_REF, ageBucket, rcmBulkAssign, rcmCaseCreate } from "@projectos/shared";
import { caseRef } from "../src/access";

describe("RCM vocabulary", () => {
  it("age buckets and their SQL ranges agree for every age 0..400", () => {
    for (let d = 0; d <= 400; d++) {
      const b = ageBucket(d);
      const [min, max] = AGE_BUCKET_RANGE[b];
      expect(d >= min && (max === null || d <= max)).toBe(true);
      const matching = RCM_AGE_BUCKETS.filter((k) => d >= AGE_BUCKET_RANGE[k][0] && (AGE_BUCKET_RANGE[k][1] === null || d <= AGE_BUCKET_RANGE[k][1]!));
      expect(matching).toEqual([b]);
    }
  });

  it("only synthetic claim references are accepted", () => {
    expect(SYNTHETIC_CLAIM_REF.test("SYN-CLM-10001")).toBe(true);
    for (const bad of ["1234567890", "CLM-1", "syn-", "SYN-<script>", "SYN-123 456"]) expect(SYNTHETIC_CLAIM_REF.test(bad)).toBe(false);
    const ok = rcmCaseCreate.safeParse({
      queueId: crypto.randomUUID(),
      caseType: "DENIAL",
      claimRef: "syn-clm-1",
      payerId: crypto.randomUUID(),
      serviceDate: "2026-09-01",
      amountCents: 100,
    });
    expect(ok.success && ok.data.claimRef).toBe("SYN-CLM-1");
  });

  it("bulk assignment is bounded", () => {
    expect(rcmBulkAssign.safeParse({ caseIds: [], ownerUserId: null }).success).toBe(false);
    expect(rcmBulkAssign.safeParse({ caseIds: Array.from({ length: 201 }, () => crypto.randomUUID()), ownerUserId: null }).success).toBe(false);
  });

  it("formats case references", () => {
    expect(caseRef(7)).toBe("RCM-0007");
    expect(caseRef(12345)).toBe("RCM-12345");
  });
});
