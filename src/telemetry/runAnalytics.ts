export interface EventRecord {
  ts: string;
  level: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface RunMetricRecord {
  ts: string;
  runId: string;
  status: "completed" | "stopped" | "failed";
  elapsedMs: number;
  stepsExecuted: number;
  avgStepMs: number;
}

export interface RunOutcomeRecord {
  runId: string;
  status: "completed" | "stopped" | "failed";
  summary: string;
}

export interface RunAnalyticsOptions {
  recentRuns: number;
  topFailureReasons: number;
  slowRunMs: number;
}

export interface RunAnalyticsReport {
  analyzedRuns: number;
  statusCounts: Record<RunMetricRecord["status"], number>;
  elapsedMs: {
    avg: number;
    p50: number;
    p90: number;
    max: number;
  };
  avgStepsExecuted: number;
  slowRuns: number;
  topFailureSummaries: Array<{ summary: string; count: number }>;
  recentRunIds: string[];
}

export function parseEventRecords(raw: string): EventRecord[] {
  const records: EventRecord[] = [];
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as EventRecord;
      if (!parsed || typeof parsed !== "object") {
        continue;
      }
      if (typeof parsed.message !== "string" || typeof parsed.ts !== "string") {
        continue;
      }
      records.push(parsed);
    } catch {
      // Ignore malformed lines.
    }
  }

  return records;
}

export function extractRunMetricRecords(records: EventRecord[]): RunMetricRecord[] {
  const metrics: RunMetricRecord[] = [];

  for (const record of records) {
    if (record.message !== "Метрики выполнения" || !record.data) {
      continue;
    }

    const runId = record.data.runId;
    const status = record.data.status;
    const elapsedMs = record.data.elapsedMs;
    const stepsExecuted = record.data.stepsExecuted;
    const avgStepMs = record.data.avgStepMs;

    if (typeof runId !== "string") {
      continue;
    }
    if (status !== "completed" && status !== "stopped" && status !== "failed") {
      continue;
    }
    if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
      continue;
    }
    if (typeof stepsExecuted !== "number" || !Number.isFinite(stepsExecuted) || stepsExecuted < 0) {
      continue;
    }
    if (typeof avgStepMs !== "number" || !Number.isFinite(avgStepMs) || avgStepMs < 0) {
      continue;
    }

    metrics.push({
      ts: record.ts,
      runId,
      status,
      elapsedMs: Math.round(elapsedMs),
      stepsExecuted: Math.round(stepsExecuted),
      avgStepMs: Math.round(avgStepMs)
    });
  }

  return metrics;
}

export function extractRunOutcomes(records: EventRecord[]): Map<string, RunOutcomeRecord> {
  const outcomes = new Map<string, RunOutcomeRecord>();

  for (const record of records) {
    if (record.message !== "Задача завершена" || !record.data) {
      continue;
    }

    const runId = record.data.runId;
    const status = record.data.status;
    const summary = record.data.summary;

    if (typeof runId !== "string") {
      continue;
    }
    if (status !== "completed" && status !== "stopped" && status !== "failed") {
      continue;
    }
    if (typeof summary !== "string" || summary.trim().length === 0) {
      continue;
    }

    outcomes.set(runId, {
      runId,
      status,
      summary: summary.trim()
    });
  }

  return outcomes;
}

export function buildRunAnalyticsReport(records: EventRecord[], options: RunAnalyticsOptions): RunAnalyticsReport {
  const extractedMetrics = extractRunMetricRecords(records);
  const recent = extractedMetrics.slice(-options.recentRuns);
  const outcomes = extractRunOutcomes(records);

  const statusCounts: Record<RunMetricRecord["status"], number> = {
    completed: 0,
    stopped: 0,
    failed: 0
  };

  for (const item of recent) {
    statusCounts[item.status] += 1;
  }

  const elapsedValues = recent.map((item) => item.elapsedMs).sort((left, right) => left - right);
  const stepsValues = recent.map((item) => item.stepsExecuted);
  const failureCounter = new Map<string, number>();

  for (const item of recent) {
    if (item.status !== "failed") {
      continue;
    }
    const outcome = outcomes.get(item.runId);
    const summary = outcome?.summary ?? "Неизвестная причина";
    failureCounter.set(summary, (failureCounter.get(summary) ?? 0) + 1);
  }

  const topFailureSummaries = Array.from(failureCounter.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, options.topFailureReasons)
    .map(([summary, count]) => ({ summary, count }));

  return {
    analyzedRuns: recent.length,
    statusCounts,
    elapsedMs: {
      avg: roundSafe(average(elapsedValues)),
      p50: roundSafe(percentile(elapsedValues, 0.5)),
      p90: roundSafe(percentile(elapsedValues, 0.9)),
      max: roundSafe(elapsedValues.at(-1) ?? 0)
    },
    avgStepsExecuted: roundSafe(average(stepsValues), 2),
    slowRuns: recent.filter((item) => item.elapsedMs >= options.slowRunMs).length,
    topFailureSummaries,
    recentRunIds: recent.map((item) => item.runId)
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((accumulator, value) => accumulator + value, 0);
  return sum / values.length;
}

function percentile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const safeRatio = Math.min(1, Math.max(0, ratio));
  const index = Math.floor((sortedValues.length - 1) * safeRatio);
  return sortedValues[index] ?? 0;
}

function roundSafe(value: number, digits = 0): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = Math.pow(10, Math.max(0, digits));
  return Math.round(value * factor) / factor;
}
