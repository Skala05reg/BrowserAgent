import { RuntimeConfig } from "../config/types.js";
import { AgentDecision } from "../core/types.js";
import { DecisionInput, ModelClient } from "./modelGateway.js";

const URL_REGEX = /(https?:\/\/[\w.-]+(?:\/[\w\-._~:/?#[\]@!$&'()*+,;=]*)?)/i;

export class RuleBasedModelClient implements ModelClient {
  public constructor(private readonly runtimeConfig: RuntimeConfig) {}

  public async decide(input: DecisionInput): Promise<AgentDecision> {
    const explicitUrl = input.task.match(URL_REGEX)?.[1];

    if ((input.snapshot.url === "about:blank" || input.step === 1) && explicitUrl) {
      return {
        thoughtSummary: "В задаче найден явный URL, начну с перехода на него.",
        reasoning: "Явный URL в задаче обычно является стартовой точкой для выполнения.",
        riskLevel: "safe",
        requiresConfirmation: false,
        successCriteria: "Открыта целевая страница из задачи.",
        action: {
          name: "navigate",
          args: {
            url: explicitUrl
          }
        }
      };
    }

    if (input.snapshot.url === "about:blank") {
      return {
        thoughtSummary: "Страница еще не открыта, перехожу на стартовый URL.",
        reasoning: "Нужна стартовая точка для дальнейших действий.",
        riskLevel: "safe",
        requiresConfirmation: false,
        successCriteria: "Открыт стартовый URL.",
        action: {
          name: "navigate",
          args: {
            url: this.runtimeConfig.agent.defaultStartUrl
          }
        }
      };
    }

    return {
      thoughtSummary: "Нет надежного решения в rule-based режиме, нужен пользовательский ввод или LLM.",
      reasoning: "Rule-based fallback ограничен и не умеет принимать сложные решения без модели.",
      riskLevel: "safe",
      requiresConfirmation: false,
      successCriteria: "Пользователь уточнил дальнейшее действие или подключен модельный провайдер.",
      action: {
        name: "ask_user",
        args: {
          question:
            "Нужна модель openai_compatible для автономных решений. Проверь API-ключ/базовый URL или дай уточнение следующего шага."
        }
      }
    };
  }
}
