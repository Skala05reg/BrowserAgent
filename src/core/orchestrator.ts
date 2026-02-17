import crypto from "node:crypto";
import { RuntimeConfig } from "../config/types.js";
import { ConsoleLogger } from "../telemetry/consoleLogger.js";
import { BrowserRuntime } from "../browser/browserRuntime.js";
import { ToolRegistry } from "../tools/toolRegistry.js";
import { ModelGateway } from "../model/modelGateway.js";
import { ContextEngine, ContextPacket } from "../context/contextEngine.js";
import { SubAgentRouter } from "./subAgentRouter.js";
import { RecoveryManager } from "./recoveryManager.js";
import { ApprovalGate } from "./approvalGate.js";
import { PauseController } from "./pauseController.js";
import { AgentAction, AgentDecision, AgentHistoryItem, AgentTaskResult, PageSnapshot, PendingApproval } from "./types.js";

export interface OrchestratorStatus {
  running: boolean;
  paused: boolean;
  pauseReason: "manual" | "ask_user" | "recovery" | null;
  stopped: boolean;
  step: number;
  runId: string | null;
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
  private pauseReason: "manual" | "ask_user" | "recovery" | null = null;
  private lastDecisionDigestSignature: string | null = null;
  private repeatedDecisionDigestCount = 0;
  private currentRunId: string | null = null;

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
    this.pauseReason = null;
    this.lastDecisionDigestSignature = null;
    this.repeatedDecisionDigestCount = 0;
    const runId = crypto.randomUUID();
    const runStartedAt = Date.now();
    this.currentRunId = runId;
    this.pauseController.reset();

    this.logger.status("Новая задача принята", { task, runId, maxRunMs: this.config.agent.maxRunMs });

    try {
      await this.browserRuntime.start();

      for (let step = 1; step <= this.config.agent.maxSteps; step += 1) {
        this.currentStep = step;
        const elapsedMs = Date.now() - runStartedAt;
        if (elapsedMs > this.config.agent.maxRunMs) {
          this.logger.warn("Превышен максимальный runtime задачи", {
            runId,
            elapsedMs,
            maxRunMs: this.config.agent.maxRunMs
          });
          return this.finalizeTaskResult(
            {
              status: "failed",
              summary: `Превышен максимальный runtime (${this.config.agent.maxRunMs}ms).`,
              stepsExecuted: step - 1
            },
            runId,
            runStartedAt
          );
        }

        if (this.pauseController.isStopped()) {
          this.logger.warn("Выполнение остановлено пользователем", { step });
          return this.finalizeTaskResult(
            {
              status: "stopped",
              summary: "Задача остановлена пользователем.",
              stepsExecuted: step - 1
            },
            runId,
            runStartedAt
          );
        }

        await this.pauseController.waitIfPaused();
        if (this.pauseController.isStopped()) {
          this.logger.warn("Выполнение остановлено пользователем", { step });
          return this.finalizeTaskResult(
            {
              status: "stopped",
              summary: "Задача остановлена пользователем.",
              stepsExecuted: step - 1
            },
            runId,
            runStartedAt
          );
        }

        let snapshot;
        try {
          snapshot = await this.browserRuntime.getSnapshot();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("context was destroyed") || message.includes("navigation")) {
            this.logger.warn(
              `STEP ${step}: контекст страницы изменился, пробую снять snapshot снова через ${this.config.agent.snapshotRetryDelayMs}мс...`
            );
            await this.sleep(this.config.agent.snapshotRetryDelayMs);
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

        let decision = await this.makeDecisionWithRetry(task, step, snapshot, contextPacket, route);
        decision = this.applyActionGuards(decision, snapshot, contextPacket, step);

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
        this.logDecisionDigest(step, decision);

        if (decision.action.name === "finish") {
          const summary = this.extractFinishSummary(decision.action.args);
          this.logger.success("Агент завершил задачу", { summary, step });
          return this.finalizeTaskResult(
            {
              status: "completed",
              summary,
              stepsExecuted: step
            },
            runId,
            runStartedAt
          );
        }

        if (decision.action.name === "ask_user") {
          this.logger.warn("Агент просит ручное участие пользователя", {
            question: String(decision.action.args.question ?? "Нужна дополнительная информация")
          });
          this.pauseReason = "ask_user";
          this.pauseController.pause();
          this.logger.status("Ожидаю ручные действия в браузере", {
            resumeHint: "После выполнения действия нажми Enter или введи /resume"
          });
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
          if (this.shouldLogActionStart(decision.action)) {
            this.logger.action(`STEP ${step}: выполняю ${decision.action.name}`, {
              args: decision.action.args
            });
          }

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
          actionResult: resultMessage,
          actionSucceeded,
          observedUrl: snapshot.url,
          observedTitle: snapshot.title
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
            this.pauseReason = "recovery";
            this.pauseController.pause();
            this.logger.warn("Recovery перевел агента в паузу до ручной проверки.");
            this.logger.status("Ожидаю ручные действия в браузере", {
              resumeHint: "После проверки нажми Enter или введи /resume"
            });
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

      return this.finalizeTaskResult(
        {
          status: "failed",
          summary: "Достигнут лимит шагов, задача не завершена.",
          stepsExecuted: this.config.agent.maxSteps
        },
        runId,
        runStartedAt
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown orchestrator error";
      this.logger.error("Критическая ошибка оркестратора", { error: message });
      return this.finalizeTaskResult(
        {
          status: "failed",
          summary: message,
          stepsExecuted: this.currentStep
        },
        runId,
        runStartedAt
      );
    } finally {
      this.running = false;
      this.currentTask = null;
      this.currentStep = 0;
      this.pauseReason = null;
      this.lastDecisionDigestSignature = null;
      this.repeatedDecisionDigestCount = 0;
      this.currentRunId = null;
      this.approvalGate.deny();
    }
  }

  public pause(): void {
    this.pauseReason = "manual";
    this.pauseController.pause();
    this.logger.status("Агент поставлен на паузу");
  }

  public resume(): void {
    this.pauseReason = null;
    this.pauseController.resume();
    this.logger.status("Агент продолжил выполнение");
  }

  public stop(): void {
    this.pauseReason = null;
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
      pauseReason: this.pauseReason,
      stopped: this.pauseController.isStopped(),
      step: this.currentStep,
      runId: this.currentRunId,
      currentTask: this.currentTask,
      pendingApproval: this.approvalGate.getPending()
    };
  }

  private finalizeTaskResult(
    result: Omit<AgentTaskResult, "runId" | "elapsedMs">,
    runId: string,
    runStartedAt: number
  ): AgentTaskResult {
    const elapsedMs = Date.now() - runStartedAt;
    const stepsExecuted = Math.max(0, result.stepsExecuted);
    const avgStepMs = stepsExecuted > 0 ? Math.round(elapsedMs / stepsExecuted) : 0;

    this.logger.status("Метрики выполнения", {
      runId,
      status: result.status,
      elapsedMs,
      stepsExecuted,
      avgStepMs
    });

    return {
      ...result,
      runId,
      elapsedMs
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

  private logDecisionDigest(step: number, decision: AgentDecision): void {
    const digest = this.config.logging.console.decisionDigest;
    if (!digest.enabled) {
      return;
    }

    const signature = `${this.actionSignature(decision.action)}|${decision.successCriteria}`;
    let repeatCount: number | null = null;

    if (digest.mode === "on_change") {
      if (this.lastDecisionDigestSignature === signature) {
        this.repeatedDecisionDigestCount += 1;
        if (this.repeatedDecisionDigestCount % digest.repeatReminderEvery !== 0) {
          return;
        }
        repeatCount = this.repeatedDecisionDigestCount;
      } else {
        this.lastDecisionDigestSignature = signature;
        this.repeatedDecisionDigestCount = 1;
      }
    } else {
      if (this.lastDecisionDigestSignature === signature) {
        this.repeatedDecisionDigestCount += 1;
        repeatCount = this.repeatedDecisionDigestCount;
      } else {
        this.lastDecisionDigestSignature = signature;
        this.repeatedDecisionDigestCount = 1;
      }
    }

    const actionLabel = this.formatActionLabel(decision.action);
    const thought = this.shorten(decision.thoughtSummary, digest.thoughtMaxLength);
    const why = this.shorten(decision.reasoning, digest.reasoningMaxLength);
    const target = this.shorten(decision.successCriteria, digest.successCriteriaMaxLength);

    this.logger.status(`STEP ${step}: план и причина`, {
      action: actionLabel,
      why,
      target,
      thought,
      ...(repeatCount ? { repeat: repeatCount } : {})
    });
  }

  private applyActionGuards(decision: AgentDecision, snapshot: PageSnapshot, contextPacket: ContextPacket, step: number): AgentDecision {
    let guarded = this.normalizeWaitAction(decision);
    if (!this.config.agent.guards.enabled) {
      return guarded;
    }

    guarded = this.normalizeActionElementReference(guarded, snapshot, contextPacket, step);

    if (guarded.action.name === "type") {
      const elementId = String(guarded.action.args.elementId ?? "").trim();
      const target = this.findElementByRef(snapshot, elementId);
      if (target && !this.isSnapshotElementTextEditable(target)) {
        this.logger.warn(`STEP ${step}: guard rewrote type -> click`, {
          reason: `element ${elementId} is not text-editable`,
          tag: target.tag,
          inputType: target.inputType ?? "-"
        });
        guarded = {
          ...guarded,
          action: {
            name: "click",
            args: { elementId }
          }
        };
      }
    }

    const sameActionStreak = this.countRecentSameActionStreak(guarded.action);
    if (guarded.action.name === "click" && sameActionStreak >= this.config.agent.guards.maxRepeatedActionBeforeRewrite) {
      const elementId = String(guarded.action.args.elementId ?? "").trim();
      const target = this.findElementByRef(snapshot, elementId);
      if (target?.href) {
        this.logger.warn(`STEP ${step}: guard rewrote repeated click -> navigate`, {
          streak: sameActionStreak + 1,
          elementId,
          href: target.href
        });
        guarded = {
          ...guarded,
          action: {
            name: "navigate",
            args: { url: target.href }
          }
        };
      }
    }

    if (guarded.action.name === "scroll" && sameActionStreak >= this.config.agent.guards.maxRepeatedScrollBeforeHotkey) {
      const direction = String(guarded.action.args.direction ?? "down").toLowerCase() === "up" ? "up" : "down";
      const breakKey = direction === "up" ? this.config.agent.guards.scrollBreakKeyUp : this.config.agent.guards.scrollBreakKeyDown;
      this.logger.warn(`STEP ${step}: guard rewrote repeated scroll -> press`, {
        streak: sameActionStreak + 1,
        breakKey
      });
      guarded = {
        ...guarded,
        action: {
          name: "press",
          args: { key: breakKey }
        }
      };
    }

    guarded = this.applyOscillationGuard(guarded, snapshot, contextPacket, step);

    return guarded;
  }

  private normalizeWaitAction(decision: AgentDecision): AgentDecision {
    if (decision.action.name !== "wait") {
      return decision;
    }

    const rawMs = decision.action.args.ms;
    if (typeof rawMs === "number" && Number.isFinite(rawMs)) {
      return decision;
    }

    const rawDuration = decision.action.args.duration;
    if (typeof rawDuration !== "number" || !Number.isFinite(rawDuration)) {
      return decision;
    }

    const ms = Math.max(0, Math.round(rawDuration <= 60 ? rawDuration * 1000 : rawDuration));
    return {
      ...decision,
      action: {
        ...decision.action,
        args: {
          ...decision.action.args,
          ms
        }
      }
    };
  }

  private normalizeActionElementReference(
    decision: AgentDecision,
    snapshot: PageSnapshot,
    contextPacket: ContextPacket,
    step: number
  ): AgentDecision {
    if (decision.action.name !== "click" && decision.action.name !== "type") {
      return decision;
    }

    const ref = String(decision.action.args.elementId ?? "").trim();
    if (!ref) {
      return decision;
    }

    const target = this.findElementByRef(snapshot, ref);
    if (target) {
      if (target.id !== ref) {
        this.logger.warn(`STEP ${step}: guard remapped element reference`, {
          from: ref,
          to: target.id
        });
        return {
          ...decision,
          action: {
            ...decision.action,
            args: {
              ...decision.action.args,
              elementId: target.id
            }
          }
        };
      }
      return decision;
    }

    if (decision.action.name === "type") {
      const fallback = contextPacket.rankedElements.find((item) => this.isSnapshotElementTextEditable(item));
      if (fallback) {
        this.logger.warn(`STEP ${step}: guard rewrote unknown type target`, {
          from: ref,
          to: fallback.id
        });
        return {
          ...decision,
          action: {
            ...decision.action,
            args: {
              ...decision.action.args,
              elementId: fallback.id
            }
          }
        };
      }
    }

    return decision;
  }

  private applyOscillationGuard(
    decision: AgentDecision,
    snapshot: PageSnapshot,
    contextPacket: ContextPacket,
    step: number
  ): AgentDecision {
    if (decision.action.name !== "click" && decision.action.name !== "navigate") {
      return decision;
    }

    const oscillation = this.detectUrlOscillation(snapshot.url);
    if (!oscillation.detected) {
      return decision;
    }

    const targetUrl = this.extractActionTargetUrl(decision.action, snapshot);
    if (!targetUrl) {
      return decision;
    }

    const normalizedTarget = this.normalizeUrlForLoop(targetUrl);
    if (!normalizedTarget || !oscillation.urls.has(normalizedTarget)) {
      return decision;
    }

    const breakout = this.findBreakoutNavigationTarget(snapshot, contextPacket, oscillation.urls);
    if (!breakout?.href) {
      return decision;
    }

    this.logger.warn(`STEP ${step}: guard rewrote oscillating action -> navigate`, {
      from: decision.action.name,
      target: normalizedTarget,
      to: breakout.href,
      reason: "URL oscillation detected"
    });

    return {
      ...decision,
      action: {
        name: "navigate",
        args: { url: breakout.href }
      }
    };
  }

  private findElementByRef(snapshot: PageSnapshot, elementRef: string): PageSnapshot["elements"][number] | undefined {
    if (!elementRef) {
      return undefined;
    }
    const byId = snapshot.elements.find((item) => item.id === elementRef);
    if (byId) {
      return byId;
    }
    return snapshot.elements.find((item) => item.domId && item.domId === elementRef);
  }

  private isSnapshotElementTextEditable(element: {
    tag: string;
    role: string;
    inputType?: string;
    disabled: boolean;
  }): boolean {
    if (element.disabled) {
      return false;
    }

    const tag = element.tag.toLowerCase();
    const role = element.role.toLowerCase();
    const inputType = (element.inputType ?? "text").toLowerCase();

    if (tag === "textarea") {
      return true;
    }

    if (tag === "input") {
      return this.config.browser.typeActionAllowedInputTypes.includes(inputType);
    }

    return ["textbox", "searchbox", "combobox"].includes(role);
  }

  private countRecentSameActionStreak(action: AgentAction): number {
    const recent = this.history.slice(-this.config.agent.guards.recentActionWindow);
    const targetSignature = this.actionSignature(action);
    let streak = 0;

    for (let index = recent.length - 1; index >= 0; index -= 1) {
      const item = recent[index];
      if (!item) {
        continue;
      }

      if (this.actionSignature(item.decision.action) !== targetSignature) {
        break;
      }

      streak += 1;
    }

    return streak;
  }

  private detectUrlOscillation(currentUrl: string): { detected: boolean; urls: Set<string> } {
    const windowSize = this.config.context.loopHints.historyWindow;
    const threshold = this.config.context.loopHints.sameUrlThreshold;
    const recent = this.history.slice(-windowSize).map((item) => this.normalizeUrlForLoop(item.observedUrl));
    recent.push(this.normalizeUrlForLoop(currentUrl));

    const normalized = recent.filter((item): item is string => Boolean(item));
    if (normalized.length < threshold) {
      return { detected: false, urls: new Set(normalized) };
    }

    const unique = new Set(normalized);
    if (unique.size > 2) {
      return { detected: false, urls: unique };
    }

    let switches = 0;
    for (let index = 1; index < normalized.length; index += 1) {
      if (normalized[index] !== normalized[index - 1]) {
        switches += 1;
      }
    }

    const detected = switches >= Math.floor(normalized.length / 2);
    return { detected, urls: unique };
  }

  private extractActionTargetUrl(action: AgentAction, snapshot: PageSnapshot): string | null {
    if (action.name === "navigate") {
      const url = String(action.args.url ?? "").trim();
      return url || null;
    }

    if (action.name === "click") {
      const ref = String(action.args.elementId ?? "").trim();
      const target = this.findElementByRef(snapshot, ref);
      return target?.href ? String(target.href) : null;
    }

    return null;
  }

  private findBreakoutNavigationTarget(
    snapshot: PageSnapshot,
    contextPacket: ContextPacket,
    excludedUrls: Set<string>
  ): PageSnapshot["elements"][number] | undefined {
    const byId = new Map(snapshot.elements.map((item) => [item.id, item]));
    const ordered = contextPacket.rankedElements
      .map((item) => byId.get(item.id))
      .filter((item): item is PageSnapshot["elements"][number] => Boolean(item));

    const rest = snapshot.elements.filter((item) => !ordered.some((picked) => picked.id === item.id));
    const candidates = [...ordered, ...rest];

    const preferred = candidates.find((item) => {
      if (!item.href || item.disabled) {
        return false;
      }
      const normalized = this.normalizeUrlForLoop(item.href);
      if (!normalized || excludedUrls.has(normalized)) {
        return false;
      }
      const region = (item.region ?? "unknown").toLowerCase();
      return region !== "header" && region !== "footer" && region !== "nav";
    });
    if (preferred) {
      return preferred;
    }

    return candidates.find((item) => {
      if (!item.href || item.disabled) {
        return false;
      }
      const normalized = this.normalizeUrlForLoop(item.href);
      return Boolean(normalized && !excludedUrls.has(normalized));
    });
  }

  private normalizeUrlForLoop(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    try {
      const parsed = new URL(trimmed);
      return `${parsed.origin}${parsed.pathname}`.toLowerCase();
    } catch {
      return trimmed.split("#")[0]?.split("?")[0]?.toLowerCase() ?? "";
    }
  }

  private actionSignature(action: AgentAction): string {
    return `${action.name}:${this.stableStringify(action.args)}`;
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${this.stableStringify(nested)}`).join(",")}}`;
  }

  private formatActionLabel(action: AgentAction): string {
    if (action.name === "navigate") {
      const url = String(action.args.url ?? "").trim();
      return url ? `navigate -> ${url}` : "navigate";
    }

    if (action.name === "click") {
      const elementId = String(action.args.elementId ?? "").trim();
      return elementId ? `click ${elementId}` : "click";
    }

    if (action.name === "type") {
      const elementId = String(action.args.elementId ?? "").trim();
      const text = String(action.args.text ?? "");
      const preview = this.shorten(text.replace(/\s+/g, " ").trim(), 40);
      return elementId ? `type ${elementId}: "${preview}"` : `type "${preview}"`;
    }

    if (action.name === "press") {
      return `press ${String(action.args.key ?? "Enter")}`;
    }

    if (action.name === "scroll") {
      const direction = String(action.args.direction ?? "down");
      const amount = Number(action.args.amount ?? 0);
      return `scroll ${direction} ${Number.isFinite(amount) ? Math.abs(amount) : "-"}`;
    }

    if (action.name === "wait") {
      const raw = action.args.ms ?? action.args.duration ?? 0;
      const ms = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
      return `wait ${ms}ms`;
    }

    if (action.name === "ask_user") {
      return "ask_user";
    }

    return action.name;
  }

  private shorten(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
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

  private shouldLogActionStart(action: AgentAction): boolean {
    return this.config.logging.console.actionStartLogActions.includes(action.name);
  }

  private extractFinishSummary(args: Record<string, unknown>): string {
    const preferredKeys = ["summary", "text", "result", "message"];
    for (const key of preferredKeys) {
      const value = args[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }

    return "Задача завершена агентом.";
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
