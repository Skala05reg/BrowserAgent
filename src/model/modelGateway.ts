import { z } from "zod";
import { RuntimeConfig } from "../config/types.js";
import { AgentDecision, AgentHistoryItem, PageSnapshot } from "../core/types.js";
import { OpenAICompatibleModelClient } from "./openaiCompatibleClient.js";
import { RuleBasedModelClient } from "./ruleBasedClient.js";

export interface DecisionInput {
  task: string;
  step: number;
  history: AgentHistoryItem[];
  snapshot: PageSnapshot;
}

export interface ModelClient {
  decide(input: DecisionInput): Promise<AgentDecision>;
}

const decisionSchema = z.object({
  thoughtSummary: z.string().min(1),
  reasoning: z.string().min(1),
  riskLevel: z.enum(["safe", "sensitive", "destructive", "financial", "external_send"]),
  requiresConfirmation: z.boolean(),
  successCriteria: z.string().min(1),
  action: z.object({
    name: z.enum(["navigate", "click", "type", "press", "scroll", "wait", "finish", "ask_user"]),
    args: z.record(z.unknown())
  })
});

export class ModelGateway {
  private readonly primary: ModelClient;
  private readonly fallback: ModelClient;

  public constructor(private readonly runtimeConfig: RuntimeConfig, apiKey: string | undefined) {
    this.primary = this.buildClient(runtimeConfig.model.provider, apiKey);
    this.fallback = this.buildClient(runtimeConfig.model.fallbackProvider, apiKey);
  }

  public async decide(input: DecisionInput): Promise<AgentDecision> {
    try {
      const decision = await this.primary.decide(input);
      return decisionSchema.parse(decision);
    } catch (error) {
      if (!this.runtimeConfig.agent.allowModelFallback) {
        throw error;
      }
      const fallbackDecision = await this.fallback.decide(input);
      return decisionSchema.parse(fallbackDecision);
    }
  }

  private buildClient(provider: string, apiKey: string | undefined): ModelClient {
    if (provider === "openai_compatible") {
      return new OpenAICompatibleModelClient(this.runtimeConfig, apiKey);
    }

    if (provider === "rule_based") {
      return new RuleBasedModelClient(this.runtimeConfig);
    }

    throw new Error(`Unsupported model provider: ${provider}`);
  }
}

export function parseDecisionFromText(text: string): AgentDecision {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return decisionSchema.parse(JSON.parse(trimmed));
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end === -1 || start >= end) {
    throw new Error("Model did not return JSON decision payload");
  }

  const extracted = trimmed.slice(start, end + 1);
  return decisionSchema.parse(JSON.parse(extracted));
}
