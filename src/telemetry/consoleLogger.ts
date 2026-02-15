import fs from "node:fs";
import path from "node:path";
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
}

export class ConsoleLogger {
  private readonly jsonlPath: string;

  public constructor(private readonly config: LoggingConfig) {
    this.jsonlPath = path.resolve(process.cwd(), config.jsonlPath);
    fs.mkdirSync(path.dirname(this.jsonlPath), { recursive: true });
  }

  public system(message: string, data?: Record<string, unknown>): void {
    this.log("system", message, data);
  }

  public status(message: string, data?: Record<string, unknown>): void {
    this.log("status", message, data);
  }

  public observation(message: string, data?: Record<string, unknown>): void {
    this.log("observation", message, data);
  }

  public decision(message: string, data?: Record<string, unknown>): void {
    this.log("decision", message, data);
  }

  public action(message: string, data?: Record<string, unknown>): void {
    this.log("action", message, data);
  }

  public approval(message: string, data?: Record<string, unknown>): void {
    this.log("approval", message, data);
  }

  public success(message: string, data?: Record<string, unknown>): void {
    this.log("success", message, data);
  }

  public warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  public error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const ts = this.config.timeFormat === "locale" ? new Date().toLocaleTimeString() : new Date().toISOString();
    const label = `[${level.toUpperCase()}]`;
    const line = `${ts} ${label} ${message}`;

    const colored = this.applyColor(level, line);
    // eslint-disable-next-line no-console
    console.log(colored);

    if (data && Object.keys(data).length > 0) {
      const serialized = JSON.stringify(data, null, 2);
      const indented = serialized
        .split("\n")
        .map((item) => `  ${item}`)
        .join("\n");
      // eslint-disable-next-line no-console
      console.log(this.applyColor(level, indented));
    }

    const record: LogRecord = { ts: new Date().toISOString(), level, message, data };
    fs.appendFileSync(this.jsonlPath, `${JSON.stringify(record)}\n`, "utf8");
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
