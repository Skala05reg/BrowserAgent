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
    rotation: {
      enabled: true,
      maxFileSizeBytes: 10_000,
      maxArchiveFiles: 2
    },
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

  it("rotates oversized files on startup and keeps archives", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-logger-rotate-startup-"));
    const config = createLoggingConfig(tmpDir);
    config.rotation.maxFileSizeBytes = 120;
    config.rotation.maxArchiveFiles = 2;

    fs.writeFileSync(path.join(tmpDir, "events.jsonl"), "x".repeat(300), "utf8");
    fs.writeFileSync(path.join(tmpDir, "debug.txt"), "y".repeat(300), "utf8");

    const logger = new ConsoleLogger(config);
    logger.status("after rotate");
    logger.close();

    await new Promise((resolve) => setTimeout(resolve, 30));

    const jsonlArchived =
      fs.existsSync(path.join(tmpDir, "events.jsonl.1")) || fs.existsSync(path.join(tmpDir, "events.jsonl.2"));
    const debugArchived =
      fs.existsSync(path.join(tmpDir, "debug.txt.1")) || fs.existsSync(path.join(tmpDir, "debug.txt.2"));

    expect(jsonlArchived).toBe(true);
    expect(debugArchived).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "events.jsonl"), "utf8")).toContain("after rotate");
    expect(fs.readFileSync(path.join(tmpDir, "debug.txt"), "utf8")).toContain("after rotate");
  });

  it("rotates files during runtime when size exceeds threshold", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-logger-rotate-runtime-"));
    const config = createLoggingConfig(tmpDir);
    config.rotation.maxFileSizeBytes = 240;
    config.rotation.maxArchiveFiles = 2;

    const logger = new ConsoleLogger(config);
    for (let index = 0; index < 12; index += 1) {
      logger.status(`evt-${index}`, {
        payload: "z".repeat(80)
      });
    }
    logger.close();

    await new Promise((resolve) => setTimeout(resolve, 40));

    const jsonlArchived =
      fs.existsSync(path.join(tmpDir, "events.jsonl.1")) || fs.existsSync(path.join(tmpDir, "events.jsonl.2"));
    const debugArchived =
      fs.existsSync(path.join(tmpDir, "debug.txt.1")) || fs.existsSync(path.join(tmpDir, "debug.txt.2"));

    expect(jsonlArchived).toBe(true);
    expect(debugArchived).toBe(true);
    expect(fs.statSync(path.join(tmpDir, "events.jsonl")).size).toBeGreaterThan(0);
    expect(fs.statSync(path.join(tmpDir, "debug.txt")).size).toBeGreaterThan(0);
  });
});
