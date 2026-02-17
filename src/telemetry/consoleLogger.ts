import fs from "node:fs";
import path from "node:path";
import { inspect } from "node:util";
import { createWriteStream, WriteStream } from "node:fs";
import chalk from "chalk";
import { LoggingConfig } from "../config/types.js";

export type LogLevel =
  | "system"
  | "status"
  | "observation"
  | "decision"
  | "action"
  | "approval"
  | "success"
  | "warn"
  | "error";

interface LogRecord {
  ts: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
  monitorData?: Record<string, unknown>;
  debugData?: Record<string, unknown>;
}

export class ConsoleLogger {
  private readonly jsonlPath: string;
  private readonly debugTextPath: string;
  private readonly visibleLevels: Set<LogLevel>;
  private readonly jsonlStream: WriteStream;
  private readonly debugTextStream: WriteStream;
  private readonly redactionKeys: string[];
  private closed = false;

  public constructor(private readonly config: LoggingConfig) {
    this.jsonlPath = path.resolve(process.cwd(), config.jsonlPath);
    this.debugTextPath = path.resolve(process.cwd(), config.debugTextPath);
    this.visibleLevels = new Set(config.console.visibleLevels as LogLevel[]);
    this.redactionKeys = config.redaction.keys.map((item) => item.toLowerCase());
    fs.mkdirSync(path.dirname(this.jsonlPath), { recursive: true });
    fs.mkdirSync(path.dirname(this.debugTextPath), { recursive: true });

    this.jsonlStream = createWriteStream(this.jsonlPath, { flags: "a", encoding: "utf8" });
    this.debugTextStream = createWriteStream(this.debugTextPath, { flags: "a", encoding: "utf8" });
    this.jsonlStream.on("error", (error) => {
      // eslint-disable-next-line no-console
      console.error(`Logger jsonl stream error: ${error.message}`);
    });
    this.debugTextStream.on("error", (error) => {
      // eslint-disable-next-line no-console
      console.error(`Logger debug stream error: ${error.message}`);
    });

    const closeStreams = () => {
      this.close();
    };
    process.once("beforeExit", closeStreams);
    process.once("exit", closeStreams);
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.jsonlStream.end();
    this.debugTextStream.end();
  }

  public system(message: string, monitorData?: Record<string, unknown>, debugData?: Record<string, unknown>): void {
    this.log("system", message, monitorData, debugData);
  }

  public status(message: string, monitorData?: Record<string, unknown>, debugData?: Record<string, unknown>): void {
    this.log("status", message, monitorData, debugData);
  }

  public observation(message: string, monitorData?: Record<string, unknown>, debugData?: Record<string, unknown>): void {
    this.log("observation", message, monitorData, debugData);
  }

  public decision(message: string, monitorData?: Record<string, unknown>, debugData?: Record<string, unknown>): void {
    this.log("decision", message, monitorData, debugData);
  }

  public action(message: string, monitorData?: Record<string, unknown>, debugData?: Record<string, unknown>): void {
    this.log("action", message, monitorData, debugData);
  }

  public approval(message: string, monitorData?: Record<string, unknown>, debugData?: Record<string, unknown>): void {
    this.log("approval", message, monitorData, debugData);
  }

  public success(message: string, monitorData?: Record<string, unknown>, debugData?: Record<string, unknown>): void {
    this.log("success", message, monitorData, debugData);
  }

  public warn(message: string, monitorData?: Record<string, unknown>, debugData?: Record<string, unknown>): void {
    this.log("warn", message, monitorData, debugData);
  }

  public error(message: string, monitorData?: Record<string, unknown>, debugData?: Record<string, unknown>): void {
    this.log("error", message, monitorData, debugData);
  }

  private log(
    level: LogLevel,
    message: string,
    monitorData?: Record<string, unknown>,
    debugData?: Record<string, unknown>
  ): void {
    const redactedMonitorData = monitorData ? this.redactValue(monitorData) : undefined;
    const rawDebugPayload = debugData ?? monitorData;
    const redactedDebugPayload = rawDebugPayload ? this.redactValue(rawDebugPayload) : undefined;

    const ts = this.config.timeFormat === "locale" ? new Date().toLocaleTimeString() : new Date().toISOString();
    const label = `[${level.toUpperCase()}]`;
    const line = `${ts} ${label} ${message}`;
    const shouldPrintToConsole = this.visibleLevels.has(level);

    if (shouldPrintToConsole) {
      const colored = this.applyColor(level, line);
      // eslint-disable-next-line no-console
      console.log(colored);
    }

    if (shouldPrintToConsole && redactedMonitorData && Object.keys(redactedMonitorData).length > 0) {
      const lines = this.formatMonitorDataLines(redactedMonitorData);
      for (const item of lines) {
        // eslint-disable-next-line no-console
        console.log(this.applyColor(level, `  ${item}`));
      }
    }

    const record: LogRecord = {
      ts: new Date().toISOString(),
      level,
      message,
      data: redactedDebugPayload,
      monitorData: redactedMonitorData,
      debugData: redactedDebugPayload
    };

    const jsonlRecord: LogRecord = {
      ts: record.ts,
      level: record.level,
      message: record.message,
      data: record.data
    };

    if (this.config.jsonlIncludeMonitorData && redactedMonitorData) {
      jsonlRecord.monitorData = redactedMonitorData;
    }
    if (this.config.jsonlIncludeDebugData && redactedDebugPayload) {
      jsonlRecord.debugData = redactedDebugPayload;
    }

    this.jsonlStream.write(`${this.safeStringify(jsonlRecord, false)}\n`);
    this.appendDebugText(record);
  }

  private appendDebugText(record: LogRecord): void {
    const lines: string[] = [`${record.ts} [${record.level.toUpperCase()}] ${record.message}`];

    if (record.monitorData && Object.keys(record.monitorData).length > 0) {
      lines.push(`monitor: ${this.safeStringify(record.monitorData, false)}`);
    }

    if (record.debugData && Object.keys(record.debugData).length > 0) {
      lines.push("debug:");
      lines.push(
        ...this.safeStringify(record.debugData, true)
          .split("\n")
          .map((line) => `  ${line}`)
      );
    }

    lines.push("");
    this.debugTextStream.write(`${lines.join("\n")}\n`);
  }

  private formatMonitorDataLines(data: Record<string, unknown>): string[] {
    const entries = Object.entries(data);
    const maxKeys = this.config.console.maxInlineObjectKeys;
    const picked = entries.slice(0, maxKeys);
    const compactParts: string[] = [];
    const detailLines: string[] = [];

    for (const [key, value] of picked) {
      if (this.isImportantKey(key)) {
        detailLines.push(`${key}=${this.formatInlineValue(value, false, 0)}`);
      } else {
        compactParts.push(`${key}=${this.formatInlineValue(value, true, 0)}`);
      }
    }

    if (entries.length > maxKeys) {
      compactParts.push(`+${entries.length - maxKeys} fields`);
    }

    const lines: string[] = [];
    if (compactParts.length > 0) {
      lines.push(this.truncate(compactParts.join(" | "), this.config.console.maxInlineLineLength));
    }
    lines.push(...detailLines);
    return lines;
  }

  private formatInlineValue(value: unknown, truncateValue: boolean, depth: number): string {
    const maxValueLength = this.config.console.maxInlineValueLength;
    const maxArrayItems = this.config.console.maxInlineArrayItems;
    const maxObjectKeys = this.config.console.maxInlineObjectKeys;

    if (!truncateValue) {
      if (typeof value === "string") {
        return this.normalizeInlineString(value);
      }
      return this.safeStringify(value, false);
    }

    if (value === null || typeof value === "undefined") {
      return "-";
    }

    if (typeof value === "string") {
      return this.truncate(this.normalizeInlineString(value), maxValueLength);
    }

    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return String(value);
    }

    if (Array.isArray(value)) {
      const head = value.slice(0, maxArrayItems).map((item) => this.formatInlineValue(item, true, depth + 1));
      const suffix = value.length > maxArrayItems ? `, +${value.length - maxArrayItems}` : "";
      return this.truncate(`[${head.join(", ")}${suffix}]`, maxValueLength);
    }

    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) {
        return "{}";
      }

      if (depth >= 1) {
        const keys = entries.slice(0, maxObjectKeys).map(([key]) => key);
        const suffix = entries.length > maxObjectKeys ? `, +${entries.length - maxObjectKeys}` : "";
        return this.truncate(`{${keys.join(", ")}${suffix}}`, maxValueLength);
      }

      const nested = entries
        .slice(0, maxObjectKeys)
        .map(([key, nestedValue]) => `${key}:${this.formatInlineValue(nestedValue, true, depth + 1)}`);
      if (entries.length > maxObjectKeys) {
        nested.push(`+${entries.length - maxObjectKeys}`);
      }
      return this.truncate(`{${nested.join(", ")}}`, maxValueLength);
    }

    return this.truncate(String(value), maxValueLength);
  }

  private isImportantKey(key: string): boolean {
    return this.config.console.neverTruncateKeys.includes(key);
  }

  private normalizeInlineString(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    if (maxLength <= 3) {
      return value.slice(0, maxLength);
    }

    return `${value.slice(0, maxLength - 3)}...`;
  }

  private safeStringify(value: unknown, pretty: boolean): string {
    try {
      const serialized = JSON.stringify(value, null, pretty ? 2 : 0);
      if (typeof serialized !== "undefined") {
        return serialized;
      }
      return String(value);
    } catch {
      return inspect(value, { depth: 6, breakLength: 120, compact: !pretty });
    }
  }

  private applyColor(level: LogLevel, line: string): string {
    const colorName = this.config.colors[level];
    const palette: Record<string, (value: string) => string> = {
      cyan: chalk.cyan,
      blue: chalk.blue,
      gray: chalk.gray,
      magenta: chalk.magenta,
      blueBright: chalk.blueBright,
      yellow: chalk.yellow,
      green: chalk.green,
      yellowBright: chalk.yellowBright,
      redBright: chalk.redBright
    };
    return (palette[colorName] ?? ((value: string) => value))(line);
  }

  private redactValue<T>(value: T, currentKey = ""): T {
    if (!this.config.redaction.enabled) {
      return value;
    }

    if (this.shouldRedactKey(currentKey)) {
      return this.config.redaction.mask as T;
    }

    if (typeof value === "string") {
      return this.redactStringSecrets(value) as T;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.redactValue(item)) as T;
    }

    if (value && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        result[key] = this.redactValue(nested, key);
      }
      return result as T;
    }

    return value;
  }

  private shouldRedactKey(key: string): boolean {
    if (!key) {
      return false;
    }
    const normalized = key.toLowerCase();
    return this.redactionKeys.some((pattern) => normalized === pattern || normalized.includes(pattern));
  }

  private redactStringSecrets(value: string): string {
    const mask = this.config.redaction.mask;
    return value
      .replace(/\b(Bearer)\s+([A-Za-z0-9._-]+)/gi, `$1 ${mask}`)
      .replace(/([?&](?:token|access_token|api_key|apikey|auth|password|session)=)[^&\s]+/gi, `$1${mask}`);
  }
}
