import { describe, expect, it } from "vitest";
import { buildRunAnalyticsReport, parseEventRecords } from "../../src/telemetry/runAnalytics.js";

describe("runAnalytics", () => {
  it("builds summary metrics for recent runs", () => {
    const raw = [
      JSON.stringify({
        ts: "2026-02-17T00:00:00.000Z",
        level: "status",
        message: "Метрики выполнения",
        data: { runId: "r1", status: "completed", elapsedMs: 1000, stepsExecuted: 2, avgStepMs: 500 }
      }),
      JSON.stringify({
        ts: "2026-02-17T00:00:10.000Z",
        level: "status",
        message: "Метрики выполнения",
        data: { runId: "r2", status: "failed", elapsedMs: 3000, stepsExecuted: 4, avgStepMs: 750 }
      }),
      JSON.stringify({
        ts: "2026-02-17T00:00:11.000Z",
        level: "status",
        message: "Задача завершена",
        data: { runId: "r2", status: "failed", summary: "timeout" }
      }),
      JSON.stringify({
        ts: "2026-02-17T00:00:20.000Z",
        level: "status",
        message: "Метрики выполнения",
        data: { runId: "r3", status: "completed", elapsedMs: 5000, stepsExecuted: 5, avgStepMs: 1000 }
      }),
      ""
    ].join("\n");

    const records = parseEventRecords(raw);
    const report = buildRunAnalyticsReport(records, {
      recentRuns: 2,
      topFailureReasons: 3,
      slowRunMs: 4000
    });

    expect(report.analyzedRuns).toBe(2);
    expect(report.statusCounts.completed).toBe(1);
    expect(report.statusCounts.failed).toBe(1);
    expect(report.elapsedMs.avg).toBe(4000);
    expect(report.elapsedMs.p50).toBe(3000);
    expect(report.elapsedMs.p90).toBe(3000);
    expect(report.elapsedMs.max).toBe(5000);
    expect(report.avgStepsExecuted).toBe(4.5);
    expect(report.slowRuns).toBe(1);
    expect(report.topFailureSummaries).toEqual([{ summary: "timeout", count: 1 }]);
    expect(report.recentRunIds).toEqual(["r2", "r3"]);
  });

  it("ignores malformed lines and invalid records", () => {
    const raw = [
      "not-json",
      JSON.stringify({ ts: "x", message: 10 }),
      JSON.stringify({ ts: "x", message: "Метрики выполнения", data: { runId: "r1" } }),
      JSON.stringify({
        ts: "2026-02-17T00:00:00.000Z",
        level: "status",
        message: "Метрики выполнения",
        data: { runId: "r1", status: "completed", elapsedMs: 1200, stepsExecuted: 2, avgStepMs: 600 }
      })
    ].join("\n");

    const report = buildRunAnalyticsReport(parseEventRecords(raw), {
      recentRuns: 5,
      topFailureReasons: 2,
      slowRunMs: 2000
    });

    expect(report.analyzedRuns).toBe(1);
    expect(report.statusCounts.completed).toBe(1);
    expect(report.statusCounts.failed).toBe(0);
    expect(report.topFailureSummaries).toEqual([]);
  });
});
