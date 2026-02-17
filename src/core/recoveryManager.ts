import { RecoveryConfig } from "../config/types.js";
import { AgentAction, AgentDecision } from "./types.js";

export interface RecoveryPlan {
  actions: AgentAction[];
  rationale: string[];
  shouldPause: boolean;
}

function containsAny(text: string, needles: string[]): boolean {
  const normalized = text.toLowerCase();
  return needles.some((item) => normalized.includes(item.toLowerCase()));
}

export class RecoveryManager {
  public constructor(private readonly config: RecoveryConfig) {}

  public buildPlan(decision: AgentDecision, errorMessage: string, consecutiveFailures: number): RecoveryPlan {
    if (!this.config.enabled) {
      return {
        actions: [],
        rationale: ["Recovery отключен в конфиге"],
        shouldPause: false
      };
    }

    const actions: AgentAction[] = [];
    const rationale: string[] = [];
    const waitMs = this.computeBackoffWaitMs(consecutiveFailures);

    if (consecutiveFailures >= this.config.maxConsecutiveFailuresBeforePause) {
      return {
        actions: [],
        rationale: [
          `Достигнут лимит последовательных ошибок (${consecutiveFailures}); требуется ручная проверка и resume пользователем.`
        ],
        shouldPause: true
      };
    }

    const lowerError = errorMessage.toLowerCase();
    const isTransient = containsAny(lowerError, this.config.transientErrorKeywords);

    if (isTransient && this.config.retrySameActionOnTransientErrors) {
      actions.push({
        name: "wait",
        args: { ms: waitMs }
      });
      actions.push(decision.action);
      rationale.push(`Transient ошибка: применяю wait(${waitMs}ms) + повтор последнего действия.`);
    }

    if (["click", "type", "press"].includes(decision.action.name)) {
      actions.push({
        name: "press",
        args: { key: this.config.popupDismissKey }
      });
      actions.push({
        name: "wait",
        args: { ms: waitMs }
      });
      rationale.push(`Интерактивный сбой: пробую закрыть возможный попап и подождать (${waitMs}ms).`);
    }

    if (decision.action.name === "click" || decision.action.name === "scroll") {
      actions.push({
        name: "scroll",
        args: {
          direction: "down",
          amount: this.config.scrollRecoveryAmount
        }
      });
      rationale.push("Проблема с взаимодействием: добавляю корректирующий скролл.");
    }

    if (actions.length === 0) {
      actions.push({
        name: "wait",
        args: { ms: waitMs }
      });
      rationale.push(`Базовый recovery: короткая пауза (${waitMs}ms) перед следующим шагом.`);
    }

    const deduplicated = this.deduplicateActions(actions);

    return {
      actions: deduplicated.slice(0, this.config.maxAutoRecoveryActions),
      rationale,
      shouldPause: false
    };
  }

  private computeBackoffWaitMs(consecutiveFailures: number): number {
    const base = this.config.waitMsAfterFailure;
    if (base <= 0) {
      return 0;
    }

    const exponent = Math.max(0, consecutiveFailures - 1);
    const scaled = base * Math.pow(this.config.backoffMultiplier, exponent);
    const jitterAmplitude = scaled * this.config.jitterRatio;
    const jitter = jitterAmplitude > 0 ? (Math.random() * 2 - 1) * jitterAmplitude : 0;
    const withJitter = scaled + jitter;

    const bounded = Math.min(withJitter, this.config.maxWaitMsAfterFailure);
    return Math.max(0, Math.round(bounded));
  }

  private deduplicateActions(actions: AgentAction[]): AgentAction[] {
    const deduplicated: AgentAction[] = [];
    let previousSignature = "";

    for (const action of actions) {
      const signature = `${action.name}:${this.stableStringify(action.args)}`;
      if (signature === previousSignature) {
        continue;
      }
      deduplicated.push(action);
      previousSignature = signature;
    }

    return deduplicated;
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
}
