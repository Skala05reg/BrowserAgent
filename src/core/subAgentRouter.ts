import { SubAgentsConfig } from "../config/types.js";
import { AgentHistoryItem, PageSnapshot } from "./types.js";

export type SubAgentRole = "navigator" | "extractor" | "action" | "verifier";

export interface SubAgentRoute {
  role: SubAgentRole;
  roleInstruction: string;
  rationale: string;
}

function normalize(value: string): string {
  return value.toLowerCase();
}

export class SubAgentRouter {
  public constructor(private readonly config: SubAgentsConfig) {}

  public selectRoute(step: number, task: string, snapshot: PageSnapshot, history: AgentHistoryItem[]): SubAgentRoute {
    if (!this.config.enabled) {
      return {
        role: "action",
        roleInstruction: this.config.roles.action,
        rationale: "sub-agents disabled"
      };
    }

    if (step === 1 || snapshot.url === "about:blank") {
      return this.makeRoute("navigator", "Начальный шаг задачи или пустая страница.");
    }

    if (history.length === 0) {
      return this.makeRoute("extractor", "Нет предыдущей истории, сначала нужно понять структуру страницы.");
    }

    const last = history[history.length - 1];
    if (!last) {
      return this.makeRoute("extractor", "История недоступна, сначала нужно уточнить контекст страницы.");
    }
    const lastResult = normalize(last.actionResult);

    if (!last.actionSucceeded) {
      return this.makeRoute("navigator", "Предыдущий шаг неуспешен, нужен альтернативный маршрут.");
    }

    if (lastResult.includes("error") || lastResult.includes("exception") || lastResult.includes("unknown")) {
      return this.makeRoute("navigator", "Предыдущий шаг завершился ошибкой, нужен пересмотр маршрута.");
    }

    if (last.decision.action.name === "navigate" || last.decision.action.name === "scroll") {
      return this.makeRoute("extractor", "После навигации/скролла нужно заново выделить релевантные элементы.");
    }

    if (last.decision.action.name === "click" || last.decision.action.name === "type" || last.decision.action.name === "press") {
      return this.makeRoute("verifier", "После интерактивного действия нужно проверить, достигнут ли ожидаемый эффект.");
    }

    if (snapshot.elements.length <= 3) {
      return this.makeRoute("navigator", "На странице мало доступных элементов, возможно требуется переход.");
    }

    if (normalize(task).includes("найди") || normalize(task).includes("find")) {
      return this.makeRoute("extractor", "Задача на поиск, приоритет на извлечение релевантной информации.");
    }

    return this.makeRoute("action", "Переход к целевому действию по текущему плану.");
  }

  private makeRoute(role: SubAgentRole, rationale: string): SubAgentRoute {
    return {
      role,
      roleInstruction: this.config.roles[role],
      rationale
    };
  }
}
