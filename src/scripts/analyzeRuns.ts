import fs from "node:fs";
import path from "node:path";
import { loadRuntimeConfig } from "../config/loadConfig.js";
import { buildRunAnalyticsReport, parseEventRecords } from "../telemetry/runAnalytics.js";

interface CliOptions {
  json: boolean;
  recentRuns?: number;
  slowRunMs?: number;
  topFailureReasons?: number;
  filePath?: string;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (token === "--json") {
      options.json = true;
      continue;
    }

    const next = argv[index + 1];
    if ((token === "--recent" || token === "-n") && next) {
      options.recentRuns = Number(next);
      index += 1;
      continue;
    }
    if (token === "--slow-ms" && next) {
      options.slowRunMs = Number(next);
      index += 1;
      continue;
    }
    if (token === "--top-failures" && next) {
      options.topFailureReasons = Number(next);
      index += 1;
      continue;
    }
    if (token === "--file" && next) {
      options.filePath = next;
      index += 1;
    }
  }

  return options;
}

function sanitizePositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value ?? NaN)) {
    return fallback;
  }
  const rounded = Math.round(value as number);
  if (rounded <= 0) {
    return fallback;
  }
  return rounded;
}

function main(): void {
  const runtimeConfig = loadRuntimeConfig();
  const cliOptions = parseCliOptions(process.argv.slice(2));

  const recentRuns = sanitizePositiveInt(cliOptions.recentRuns, runtimeConfig.logging.analytics.defaultRecentRuns);
  const slowRunMs = sanitizePositiveInt(cliOptions.slowRunMs, runtimeConfig.logging.analytics.slowRunMs);
  const topFailureReasons = sanitizePositiveInt(
    cliOptions.topFailureReasons,
    runtimeConfig.logging.analytics.topFailureReasons
  );

  const configuredPath = cliOptions.filePath ?? runtimeConfig.logging.jsonlPath;
  const absolutePath = path.resolve(process.cwd(), configuredPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`JSONL log file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, "utf8");
  const records = parseEventRecords(raw);
  const report = buildRunAnalyticsReport(records, {
    recentRuns,
    topFailureReasons,
    slowRunMs
  });

  if (cliOptions.json) {
    process.stdout.write(`${JSON.stringify({ file: absolutePath, ...report }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Run analytics (${absolutePath})\n`);
  process.stdout.write(`analyzedRuns=${report.analyzedRuns}\n`);
  process.stdout.write(
    `statusCounts=completed:${report.statusCounts.completed}, stopped:${report.statusCounts.stopped}, failed:${report.statusCounts.failed}\n`
  );
  process.stdout.write(
    `elapsedMs=avg:${report.elapsedMs.avg}, p50:${report.elapsedMs.p50}, p90:${report.elapsedMs.p90}, max:${report.elapsedMs.max}\n`
  );
  process.stdout.write(`avgStepsExecuted=${report.avgStepsExecuted}\n`);
  process.stdout.write(`slowRuns(>=${slowRunMs}ms)=${report.slowRuns}\n`);

  if (report.topFailureSummaries.length > 0) {
    process.stdout.write("topFailureSummaries:\n");
    for (const item of report.topFailureSummaries) {
      process.stdout.write(`- ${item.count}x ${item.summary}\n`);
    }
  } else {
    process.stdout.write("topFailureSummaries: none\n");
  }
}

main();
