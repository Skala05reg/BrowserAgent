import readline from "node:readline";
import { RuntimeConfig } from "../config/types.js";
import { ConsoleLogger } from "../telemetry/consoleLogger.js";
import { AgentOrchestrator } from "../core/orchestrator.js";
import { ApprovalGate } from "../core/approvalGate.js";
import { BrowserRuntime } from "../browser/browserRuntime.js";

export class AgentCli {
  private rl: readline.Interface;
  private activeTask: Promise<void> | null = null;

  public constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: ConsoleLogger,
    private readonly orchestrator: AgentOrchestrator,
    private readonly approvalGate: ApprovalGate,
    private readonly browserRuntime: BrowserRuntime
  ) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.config.cli.prompt
    });
  }

  public async run(): Promise<void> {
    this.printBanner();

    this.approvalGate.on("pending", () => {
      this.logger.approval("Ожидается /approve или /deny", {});
      this.rl.prompt();
    });

    this.rl.on("line", (line) => {
      void this.handleLine(line.trim());
    });

    this.rl.on("close", async () => {
      this.logger.system("Завершаю работу...");
      this.orchestrator.stop();
      await this.browserRuntime.stop();
      process.exit(0);
    });

    process.on("SIGINT", () => {
      this.rl.close();
    });

    this.rl.prompt();
  }

  private async handleLine(raw: string): Promise<void> {
    if (!raw) {
      const status = this.orchestrator.getStatus();
      if (status.running && status.paused && !status.pendingApproval && status.pauseReason !== "manual") {
        this.logger.status("Получен Enter: продолжаю выполнение после ручного шага");
        this.orchestrator.resume();
      }
      this.rl.prompt();
      return;
    }

    if (raw === "/help") {
      this.printHelp();
      this.rl.prompt();
      return;
    }

    if (raw === "/pause") {
      this.orchestrator.pause();
      this.rl.prompt();
      return;
    }

    if (raw === "/resume") {
      this.orchestrator.resume();
      this.rl.prompt();
      return;
    }

    if (raw === "/continue") {
      this.orchestrator.resume();
      this.rl.prompt();
      return;
    }

    if (raw === "/stop") {
      this.orchestrator.stop();
      this.rl.prompt();
      return;
    }

    if (raw === "/status") {
      this.logger.status("Текущий статус", this.orchestrator.getStatus() as unknown as Record<string, unknown>);
      this.rl.prompt();
      return;
    }

    if (raw === "/approve") {
      const ok = this.approvalGate.approve();
      if (!ok) {
        this.logger.warn("Нет активного запроса на подтверждение");
      }
      this.rl.prompt();
      return;
    }

    if (raw === "/deny") {
      const ok = this.approvalGate.deny();
      if (!ok) {
        this.logger.warn("Нет активного запроса на подтверждение");
      }
      this.rl.prompt();
      return;
    }

    if (raw === "/exit") {
      this.rl.close();
      return;
    }

    if (raw.startsWith("/run ")) {
      await this.startTask(raw.slice(5).trim());
      this.rl.prompt();
      return;
    }

    if (raw.startsWith("/")) {
      this.logger.warn(this.config.cli.unknownCommandMessage);
      this.rl.prompt();
      return;
    }

    await this.startTask(raw);
    this.rl.prompt();
  }

  private async startTask(task: string): Promise<void> {
    if (!task) {
      this.logger.warn(this.config.cli.idleMessage);
      return;
    }

    if (this.orchestrator.isRunning() || this.activeTask) {
      this.logger.warn(this.config.cli.busyMessage);
      return;
    }

    this.activeTask = (async () => {
      const result = await this.orchestrator.runTask(task);
      this.logger.status("Задача завершена", result as unknown as Record<string, unknown>);
    })()
      .catch((error: unknown) => {
        this.logger.error("Ошибка выполнения задачи", {
          error: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => {
        this.activeTask = null;
      });
  }

  private printBanner(): void {
    for (const line of this.config.cli.banner) {
      this.logger.system(line);
    }
  }

  private printHelp(): void {
    this.logger.system("Доступные команды:");
    this.logger.system("  /run <задача>  - запустить задачу");
    this.logger.system("  /pause         - поставить агента на паузу");
    this.logger.system("  /resume        - продолжить работу агента");
    this.logger.system("  /continue      - алиас для /resume");
    this.logger.system("  /stop          - остановить текущую задачу");
    this.logger.system("  /approve       - подтвердить рискованное действие");
    this.logger.system("  /deny          - отклонить рискованное действие");
    this.logger.system("  /status        - показать текущее состояние");
    this.logger.system("  /help          - показать справку");
    this.logger.system("  /exit          - завершить программу");
    this.logger.system("  Enter (пустая строка) - продолжить после ask_user/recovery-паузы");
  }
}
