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

export interface StepPhaseMetricRecord {
  runId: string;
  step: number;
  snapshotMs: number;
  decisionMs: number;
  actionMs: number;
  totalMs: number;
  outcome: string;
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
  stepTimingsMs: {
    samples: number;
    snapshotAvg: number;
    decisionAvg: number;
    actionAvg: number;
    totalAvg: number;
    totalP90: number;
  };
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

export function extractStepPhaseMetricRecords(records: EventRecord[]): StepPhaseMetricRecord[] {
  const result: StepPhaseMetricRecord[] = [];

  for (const record of records) {
    if (record.message !== "Метрики шага" || !record.data) {
      continue;
    }

    const runId = record.data.runId;
    const step = record.data.step;
    const snapshotMs = record.data.snapshotMs;
    const decisionMs = record.data.decisionMs;
    const actionMs = record.data.actionMs;
    const totalMs = record.data.totalMs;
    const outcome = record.data.outcome;

    if (typeof runId !== "string") {
      continue;
    }
    if (typeof step !== "number" || !Number.isFinite(step) || step <= 0) {
      continue;
    }
    if (typeof snapshotMs !== "number" || !Number.isFinite(snapshotMs) || snapshotMs < 0) {
      continue;
    }
    if (typeof decisionMs !== "number" || !Number.isFinite(decisionMs) || decisionMs < 0) {
      continue;
    }
    if (typeof actionMs !== "number" || !Number.isFinite(actionMs) || actionMs < 0) {
      continue;
    }
    if (typeof totalMs !== "number" || !Number.isFinite(totalMs) || totalMs < 0) {
      continue;
    }

    result.push({
      runId,
      step: Math.round(step),
      snapshotMs: Math.round(snapshotMs),
      decisionMs: Math.round(decisionMs),
      actionMs: Math.round(actionMs),
      totalMs: Math.round(totalMs),
      outcome: typeof outcome === "string" ? outcome : "unknown"
    });
  }

  return result;
}

export function buildRunAnalyticsReport(records: EventRecord[], options: RunAnalyticsOptions): RunAnalyticsReport {
  const extractedMetrics = extractRunMetricRecords(records);
  const recent = extractedMetrics.slice(-options.recentRuns);
  const recentRunIds = recent.map((item) => item.runId);
  const recentRunIdSet = new Set(recentRunIds);
  const outcomes = extractRunOutcomes(records);
  const stepPhaseMetrics = extractStepPhaseMetricRecords(records).filter((item) => recentRunIdSet.has(item.runId));

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
  const snapshotValues = stepPhaseMetrics.map((item) => item.snapshotMs);
  const decisionValues = stepPhaseMetrics.map((item) => item.decisionMs);
  const actionValues = stepPhaseMetrics.map((item) => item.actionMs);
  const totalStepValues = stepPhaseMetrics.map((item) => item.totalMs).sort((left, right) => left - right);
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
    stepTimingsMs: {
      samples: stepPhaseMetrics.length,
      snapshotAvg: roundSafe(average(snapshotValues)),
      decisionAvg: roundSafe(average(decisionValues)),
      actionAvg: roundSafe(average(actionValues)),
      totalAvg: roundSafe(average(totalStepValues)),
      totalP90: roundSafe(percentile(totalStepValues, 0.9))
    },
    slowRuns: recent.filter((item) => item.elapsedMs >= options.slowRunMs).length,
    topFailureSummaries,
    recentRunIds
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
  if (safeRatio <= 0) {
    return sortedValues[0] ?? 0;
  }
  if (safeRatio >= 1) {
    return sortedValues[sortedValues.length - 1] ?? 0;
  }

  const position = (sortedValues.length - 1) * safeRatio;
  const leftIndex = Math.floor(position);
  const rightIndex = Math.ceil(position);
  const left = sortedValues[leftIndex] ?? 0;
  const right = sortedValues[rightIndex] ?? left;
  const fraction = position - leftIndex;
  return left + (right - left) * fraction;
}

function roundSafe(value: number, digits = 0): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = Math.pow(10, Math.max(0, digits));
  return Math.round(value * factor) / factor;
}
