import crypto from "node:crypto";
import { RuntimeConfig } from "../config/types.js";
import { ConsoleLogger } from "../telemetry/consoleLogger.js";
import { BrowserRuntime } from "../browser/browserRuntime.js";
import { ToolRegistry } from "../tools/toolRegistry.js";
import { ModelGateway } from "../model/modelGateway.js";
import { ContextEngine } from "../context/contextEngine.js";
import { SubAgentRouter } from "./subAgentRouter.js";
import { RecoveryManager } from "./recoveryManager.js";
import { ApprovalGate } from "./approvalGate.js";
import { PauseController } from "./pauseController.js";
import { AgentAction, AgentHistoryItem, AgentTaskResult, PendingApproval } from "./types.js";

export interface OrchestratorStatus {
  running: boolean;
  paused: boolean;
  stopped: boolean;
  step: number;
  currentTask: string | null;
  pendingApproval: PendingApproval | null;
}

export class AgentOrchestrator {
  private running = false;
  private currentTask: string | null = null;
  private currentStep = 0;
  private history: AgentHistoryItem[] = [];
  private readonly contextEngine: ContextEngine;
  private readonly subAgentRouter: SubAgentRouter;
  private readonly recoveryManager: RecoveryManager;
  private consecutiveFailures = 0;

  public constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: ConsoleLogger,
    private readonly browserRuntime: BrowserRuntime,
    private readonly tools: ToolRegistry,
    private readonly modelGateway: ModelGateway,
    private readonly pauseController: PauseController,
    private readonly approvalGate: ApprovalGate
  ) {
    this.contextEngine = new ContextEngine(config.context);
    this.subAgentRouter = new SubAgentRouter(config.subAgents);
    this.recoveryManager = new RecoveryManager(config.recovery);
  }

  public async runTask(task: string): Promise<AgentTaskResult> {
    if (this.running) {
      throw new Error("Task is already running");
    }

    this.running = true;
    this.currentTask = task;
    this.currentStep = 0;
    this.history = [];
    this.consecutiveFailures = 0;
    this.pauseController.reset();

    this.logger.system("Новая задача принята", { task });

    try {
      await this.browserRuntime.start();

      for (let step = 1; step <= this.config.agent.maxSteps; step += 1) {
        this.currentStep = step;

        if (this.pauseController.isStopped()) {
          this.logger.warn("Выполнение остановлено пользователем", { step });
          return {
            status: "stopped",
            summary: "Задача остановлена пользователем.",
            stepsExecuted: step - 1
          };
        }

        await this.pauseController.waitIfPaused();

        let snapshot;
        try {
          snapshot = await this.browserRuntime.getSnapshot();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("context was destroyed") || message.includes("navigation")) {
            this.logger.warn(`STEP ${step}: контекст страницы изменился, пробую снять snapshot снова через 1с...`);
            await this.sleep(1000);
            snapshot = await this.browserRuntime.getSnapshot();
          } else {
            throw error;
          }
        }

        const observationMonitor = {
          url: snapshot.url,
          title: snapshot.title,
          elementCount: snapshot.elements.length,
          topElements: this.buildElementMonitorPreview(snapshot)
        };
        const observationDebug: Record<string, unknown> = {
          url: snapshot.url,
          title: snapshot.title,
          elements: snapshot.elements
        };
        if (this.config.logging.showObservationDetails) {
          observationDebug.textExcerpt = snapshot.textExcerpt;
        }
        this.logger.observation(`STEP ${step}: наблюдение страницы`, observationMonitor, observationDebug);

        const contextPacket = this.contextEngine.build(task, snapshot, this.history);
        const route = this.subAgentRouter.selectRoute(step, task, snapshot, this.history);
        this.logger.observation(
          `STEP ${step}: context compression`,
          {
            selected: `${contextPacket.compression.selectedElements}/${contextPacket.compression.totalElements}`,
            hints: contextPacket.attentionHints.slice(0, 2)
          },
          {
            selectedElements: contextPacket.compression.selectedElements,
            totalElements: contextPacket.compression.totalElements,
            attentionHints: contextPacket.attentionHints
          }
        );
        this.logger.observation(
          `STEP ${step}: sub-agent route`,
          { role: route.role, rationale: route.rationale },
          {
            role: route.role,
            rationale: route.rationale
          }
        );

        const decision = await this.makeDecisionWithRetry(task, step, snapshot, contextPacket, route);

        this.logger.decision(
          `STEP ${step}: решение агента`,
          {
            action: decision.action.name,
            args: decision.action.args,
            riskLevel: decision.riskLevel,
            requiresConfirmation: decision.requiresConfirmation,
            successCriteria: decision.successCriteria
          },
          {
            thoughtSummary: decision.thoughtSummary,
            reasoning: decision.reasoning,
            riskLevel: decision.riskLevel,
            requiresConfirmation: decision.requiresConfirmation,
            successCriteria: decision.successCriteria,
            action: decision.action
          }
        );

        if (decision.action.name === "finish") {
          const summary = String(decision.action.args.summary ?? "Задача завершена агентом.");
          this.logger.success("Агент завершил задачу", { summary, step });
          return {
            status: "completed",
            summary,
            stepsExecuted: step
          };
        }

        if (decision.action.name === "ask_user") {
          this.logger.warn("Агент просит ручное участие пользователя", {
            question: String(decision.action.args.question ?? "Нужна дополнительная информация")
          });
          this.pauseController.pause();
          continue;
        }

        const needsConfirmation = this.needsConfirmation(decision);
        if (needsConfirmation) {
          const request: PendingApproval = {
            requestId: crypto.randomUUID(),
            step,
            reason: "Потенциально рискованное действие",
            decision
          };

          this.logger.approval("Требуется подтверждение действия", {
            requestId: request.requestId,
            reason: request.reason,
            action: request.decision.action,
            riskLevel: request.decision.riskLevel
          });

          const approved = await this.approvalGate.requestApproval(request);
          if (!approved) {
            this.logger.warn("Действие отклонено пользователем", {
              step,
              action: decision.action
            });
            continue;
          }
          this.logger.approval("Действие подтверждено пользователем", { step, action: decision.action });
        }

        let resultMessage = "";
        let actionSucceeded = false;
        try {
          this.logger.action(`STEP ${step}: выполняю ${decision.action.name}`, {
            args: decision.action.args
          });

          const result = await this.tools.execute(decision.action);
          resultMessage = result.message;

          if (result.ok) {
            actionSucceeded = true;
            this.logger.success(
              `STEP ${step}: действие выполнено`,
              {
                action: decision.action.name,
                message: result.message
              },
              {
                action: decision.action.name,
                args: decision.action.args,
                message: result.message,
                data: result.data
              }
            );
          } else {
            this.logger.warn(
              `STEP ${step}: действие завершилось ошибкой`,
              {
                action: decision.action.name,
                message: result.message
              },
              {
                action: decision.action.name,
                args: decision.action.args,
                message: result.message
              }
            );
          }
        } catch (error) {
          resultMessage = error instanceof Error ? error.message : "Unknown tool error";
          this.logger.error(
            `STEP ${step}: исключение при выполнении действия`,
            {
              action: decision.action.name,
              error: resultMessage
            },
            {
              action: decision.action.name,
              args: decision.action.args,
              error: resultMessage
            }
          );
        }

        this.history.push({
          step,
          decision,
          actionResult: resultMessage
        });

        if (actionSucceeded) {
          this.consecutiveFailures = 0;
        } else {
          this.consecutiveFailures += 1;
          const recovery = this.recoveryManager.buildPlan(decision, resultMessage, this.consecutiveFailures);

          this.logger.warn(
            `STEP ${step}: запуск recovery-плана`,
            {
              consecutiveFailures: this.consecutiveFailures,
              rationale: recovery.rationale,
              actions: this.buildRecoveryActionNames(recovery.actions)
            },
            {
              consecutiveFailures: this.consecutiveFailures,
              rationale: recovery.rationale,
              actions: recovery.actions
            }
          );

          if (recovery.shouldPause) {
            this.pauseController.pause();
            this.logger.warn("Recovery перевел агента в паузу до ручной проверки.");
            continue;
          }

          const recovered = await this.executeRecoveryActions(step, recovery.actions);
          if (recovered) {
            this.consecutiveFailures = 0;
          }
        }

        if (this.history.length > this.config.agent.maxHistoryItems) {
          this.history = this.history.slice(this.history.length - this.config.agent.maxHistoryItems);
        }

        await this.sleep(this.config.agent.stepDelayMs);
      }

      this.logger.warn("Достигнут лимит шагов", {
        maxSteps: this.config.agent.maxSteps
      });

      return {
        status: "failed",
        summary: "Достигнут лимит шагов, задача не завершена.",
        stepsExecuted: this.config.agent.maxSteps
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown orchestrator error";
      this.logger.error("Критическая ошибка оркестратора", { error: message });
      return {
        status: "failed",
        summary: message,
        stepsExecuted: this.currentStep
      };
    } finally {
      this.running = false;
      this.currentTask = null;
      this.currentStep = 0;
      this.approvalGate.deny();
    }
  }

  public pause(): void {
    this.pauseController.pause();
    this.logger.status("Агент поставлен на паузу");
  }

  public resume(): void {
    this.pauseController.resume();
    this.logger.status("Агент продолжил выполнение");
  }

  public stop(): void {
    this.pauseController.stop();
    this.approvalGate.deny();
    this.logger.status("Запрошена остановка агента");
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getStatus(): OrchestratorStatus {
    return {
      running: this.running,
      paused: this.pauseController.isPaused(),
      stopped: this.pauseController.isStopped(),
      step: this.currentStep,
      currentTask: this.currentTask,
      pendingApproval: this.approvalGate.getPending()
    };
  }

  private async makeDecisionWithRetry(
    task: string,
    step: number,
    snapshot: Awaited<ReturnType<BrowserRuntime["getSnapshot"]>>,
    contextPacket: ReturnType<ContextEngine["build"]>,
    route: ReturnType<SubAgentRouter["selectRoute"]>
  ) {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= this.config.agent.decisionRetryCount + 1; attempt += 1) {
      try {
        return await this.modelGateway.decide({
          task,
          step,
          history: this.history,
          snapshot,
          contextPacket,
          route
        });
      } catch (error) {
        lastError = error;
        this.logger.warn(`Ошибка принятия решения (попытка ${attempt})`, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Model decision failed");
  }

  private needsConfirmation(decision: { riskLevel: string; requiresConfirmation: boolean; action: { args: Record<string, unknown> } }): boolean {
    if (decision.requiresConfirmation) {
      return true;
    }

    if (this.config.safety.requireConfirmationRiskLevels.includes(decision.riskLevel as never)) {
      return true;
    }

    const serializedArgs = JSON.stringify(decision.action.args).toLowerCase();
    return this.config.safety.keywordTriggers.some((keyword) => serializedArgs.includes(keyword.toLowerCase()));
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildElementMonitorPreview(snapshot: Awaited<ReturnType<BrowserRuntime["getSnapshot"]>>): string[] {
    return snapshot.elements.slice(0, 3).map((element) => {
      const label = element.text || element.ariaLabel || element.placeholder || element.href || element.id;
      return `${element.id}:${element.role}:${label}`;
    });
  }

  private buildRecoveryActionNames(actions: AgentAction[]): string[] {
    return actions.map((action) => action.name);
  }

  private async executeRecoveryActions(step: number, actions: AgentAction[]): Promise<boolean> {
    if (actions.length === 0) {
      return false;
    }

    let successCount = 0;
    for (const action of actions) {
      try {
        const result = await this.tools.execute(action);
        if (result.ok) {
          successCount += 1;
          this.logger.success(`STEP ${step}: recovery action success`, {
            action: action.name,
            message: result.message
          });
        } else {
          this.logger.warn(`STEP ${step}: recovery action failed`, {
            action: action.name,
            message: result.message
          });
        }
      } catch (error) {
        this.logger.error(`STEP ${step}: recovery action exception`, {
          action: action.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return successCount > 0;
  }
}
