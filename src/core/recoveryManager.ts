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
        args: { ms: this.config.waitMsAfterFailure }
      });
      actions.push(decision.action);
      rationale.push("Transient ошибка: применяю wait + повтор последнего действия.");
    }

    if (["click", "type", "press"].includes(decision.action.name)) {
      actions.push({
        name: "press",
        args: { key: this.config.popupDismissKey }
      });
      actions.push({
        name: "wait",
        args: { ms: this.config.waitMsAfterFailure }
      });
      rationale.push("Интерактивный сбой: пробую закрыть возможный попап и подождать.");
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
        args: { ms: this.config.waitMsAfterFailure }
      });
      rationale.push("Базовый recovery: короткая пауза перед следующим шагом.");
    }

    return {
      actions: actions.slice(0, this.config.maxAutoRecoveryActions),
      rationale,
      shouldPause: false
    };
  }
}
