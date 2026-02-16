import fs from "node:fs";
import path from "node:path";
import { inspect } from "node:util";
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

  public constructor(private readonly config: LoggingConfig) {
    this.jsonlPath = path.resolve(process.cwd(), config.jsonlPath);
    this.debugTextPath = path.resolve(process.cwd(), config.debugTextPath);
    fs.mkdirSync(path.dirname(this.jsonlPath), { recursive: true });
    fs.mkdirSync(path.dirname(this.debugTextPath), { recursive: true });
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
    const ts = this.config.timeFormat === "locale" ? new Date().toLocaleTimeString() : new Date().toISOString();
    const label = `[${level.toUpperCase()}]`;
    const line = `${ts} ${label} ${message}`;

    const colored = this.applyColor(level, line);
    // eslint-disable-next-line no-console
    console.log(colored);

    if (monitorData && Object.keys(monitorData).length > 0) {
      const inline = this.formatMonitorData(monitorData);
      // eslint-disable-next-line no-console
      console.log(this.applyColor(level, `  ${inline}`));
    }

    const debugPayload = debugData ?? monitorData;
    const record: LogRecord = {
      ts: new Date().toISOString(),
      level,
      message,
      data: debugPayload,
      monitorData,
      debugData: debugPayload
    };

    fs.appendFileSync(this.jsonlPath, `${this.safeStringify(record, false)}\n`, "utf8");
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
    fs.appendFileSync(this.debugTextPath, `${lines.join("\n")}\n`, "utf8");
  }

  private formatMonitorData(data: Record<string, unknown>): string {
    const entries = Object.entries(data);
    const maxKeys = this.config.console.maxInlineObjectKeys;
    const picked = entries.slice(0, maxKeys);
    const parts = picked.map(([key, value]) => `${key}=${this.formatInlineValue(value, 0)}`);
    if (entries.length > maxKeys) {
      parts.push(`+${entries.length - maxKeys} fields`);
    }

    return this.truncate(parts.join(" | "), this.config.console.maxInlineLineLength);
  }

  private formatInlineValue(value: unknown, depth: number): string {
    const maxValueLength = this.config.console.maxInlineValueLength;
    const maxArrayItems = this.config.console.maxInlineArrayItems;
    const maxObjectKeys = this.config.console.maxInlineObjectKeys;

    if (value === null || typeof value === "undefined") {
      return "-";
    }

    if (typeof value === "string") {
      return this.truncate(value.replace(/\s+/g, " ").trim(), maxValueLength);
    }

    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return String(value);
    }

    if (Array.isArray(value)) {
      const head = value.slice(0, maxArrayItems).map((item) => this.formatInlineValue(item, depth + 1));
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
        .map(([key, nestedValue]) => `${key}:${this.formatInlineValue(nestedValue, depth + 1)}`);
      if (entries.length > maxObjectKeys) {
        nested.push(`+${entries.length - maxObjectKeys}`);
      }
      return this.truncate(`{${nested.join(", ")}}`, maxValueLength);
    }

    return this.truncate(String(value), maxValueLength);
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
}
