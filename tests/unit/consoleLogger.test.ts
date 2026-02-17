import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConsoleLogger } from "../../src/telemetry/consoleLogger.js";
import { LoggingConfig } from "../../src/config/types.js";

function createLoggingConfig(tmpDir: string): LoggingConfig {
  return {
    jsonlPath: path.join(tmpDir, "events.jsonl"),
    debugTextPath: path.join(tmpDir, "debug.txt"),
    jsonlIncludeMonitorData: false,
    jsonlIncludeDebugData: false,
    showObservationDetails: false,
    timeFormat: "iso",
    redaction: {
      enabled: true,
      keys: ["token", "password", "authorization", "cookie", "api_key"],
      mask: "***REDACTED***"
    },
    console: {
      visibleLevels: [],
      maxInlineValueLength: 120,
      maxInlineArrayItems: 4,
      maxInlineObjectKeys: 8,
      maxInlineLineLength: 220,
      neverTruncateKeys: ["summary"],
      actionStartLogActions: [],
      decisionDigest: {
        enabled: false,
        mode: "on_change",
        repeatReminderEvery: 4,
        thoughtMaxLength: 100,
        reasoningMaxLength: 100,
        successCriteriaMaxLength: 100
      }
    },
    colors: {
      system: "cyan",
      status: "blue",
      observation: "gray",
      decision: "magenta",
      action: "blueBright",
      approval: "yellow",
      success: "green",
      warn: "yellowBright",
      error: "redBright"
    }
  };
}

describe("ConsoleLogger", () => {
  it("redacts secrets and keeps compact jsonl shape", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-logger-test-"));
    const logger = new ConsoleLogger(createLoggingConfig(tmpDir));

    logger.status("test", {
      url: "https://example.com/?token=super-secret",
      token: "super-secret"
    });
    logger.close();

    await new Promise((resolve) => setTimeout(resolve, 20));

    const jsonl = fs.readFileSync(path.join(tmpDir, "events.jsonl"), "utf8");
    expect(jsonl.includes("***REDACTED***")).toBe(true);
    expect(jsonl.includes("super-secret")).toBe(false);
    expect(jsonl.includes("\"monitorData\"")).toBe(false);
    expect(jsonl.includes("\"debugData\"")).toBe(false);

    const debugText = fs.readFileSync(path.join(tmpDir, "debug.txt"), "utf8");
    expect(debugText.includes("***REDACTED***")).toBe(true);
  });
});
