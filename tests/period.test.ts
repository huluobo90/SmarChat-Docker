import { test } from "node:test";
import assert from "node:assert/strict";
import { reportPeriod } from "../packages/domain/period";
test("weekly reports use Monday through Sunday in Asia/Shanghai across year boundaries", () => {
  const p = reportPeriod("week", "2026-01-01");
  assert.equal(p.start, "2025-12-28T16:00:00.000Z");
  assert.equal(p.end, "2026-01-04T16:00:00.000Z");
  assert.equal(p.startDate, "2025-12-29");
  assert.equal(p.endDate, "2026-01-04");
  assert.equal(p.days, 7);
});
test("monthly reports preserve leap days and reject impossible dates", () => {
  assert.equal(reportPeriod("month", "2024-02-29").days, 29);
  assert.equal(reportPeriod("month", "2026-02-14").days, 28);
  assert.throws(() => reportPeriod("month", "2026-02-29"));
});
