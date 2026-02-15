import { BrowserRuntime } from "../browser/browserRuntime.js";
import { AgentAction, ToolExecutionResult } from "../core/types.js";

export class ToolRegistry {
  public constructor(private readonly browserRuntime: BrowserRuntime) {}

  public async execute(action: AgentAction): Promise<ToolExecutionResult> {
    if (action.name === "finish") {
      return { ok: true, message: String(action.args.summary ?? "Task finished") };
    }

    if (action.name === "ask_user") {
      return { ok: true, message: String(action.args.question ?? "Need additional user input") };
    }

    return this.browserRuntime.executeBrowserAction(action.name, action.args);
  }
}
