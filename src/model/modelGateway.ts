import { z } from "zod";
import { RuntimeConfig } from "../config/types.js";
import { AgentDecision, AgentHistoryItem, PageSnapshot } from "../core/types.js";
import { ContextPacket } from "../context/contextEngine.js";
import { SubAgentRoute } from "../core/subAgentRouter.js";
import { AnthropicCompatibleModelClient } from "./anthropicCompatibleClient.js";
import { OpenAICompatibleModelClient } from "./openaiCompatibleClient.js";
import { RuleBasedModelClient } from "./ruleBasedClient.js";

export interface DecisionInput {
  task: string;
  step: number;
  history: AgentHistoryItem[];
  snapshot: PageSnapshot;
  contextPacket: ContextPacket;
  route: SubAgentRoute;
}

export interface ModelClient {
  decide(input: DecisionInput): Promise<AgentDecision>;
}

const decisionSchema = z.object({
  thoughtSummary: z.string().min(1),
  reasoning: z.string().min(1),
  riskLevel: z.string().min(1),
  requiresConfirmation: z.boolean(),
  successCriteria: z.string().min(1),
  action: z.object({
    name: z.enum(["navigate", "click", "type", "press", "scroll", "wait", "finish", "ask_user"]),
    args: z.unknown()
  })
});

type CanonicalRiskLevel = "safe" | "sensitive" | "destructive" | "financial" | "external_send";

function normalizeRiskLevel(value: string): CanonicalRiskLevel {
  const normalized = value.toLowerCase().trim();

  const map: Record<string, CanonicalRiskLevel> = {
    safe: "safe",
    low: "safe",
    minimal: "safe",
    sensitive: "sensitive",
    medium: "sensitive",
    moderate: "sensitive",
    destructive: "destructive",
    high: "destructive",
    critical: "destructive",
    financial: "financial",
    payment: "financial",
    external_send: "external_send",
    send: "external_send",
    outbound: "external_send"
  };

  return map[normalized] ?? "sensitive";
}

function normalizeDecisionRisk(decision: z.infer<typeof decisionSchema>): AgentDecision {
  const recoverArgsFromString = (actionName: string, raw: string): Record<string, unknown> => {
    const recovered: Record<string, unknown> = {};
    const urlMatch = raw.match(/https?:\/\/[^\s"'`]+/i);
    const elementIdMatch = raw.match(/e-\d+/i);
    const keyMatch = raw.match(/enter|escape|tab|arrowup|arrowdown|arrowleft|arrowright/i);
    const msMatch = raw.match(/(\d{2,6})/);

    if (actionName === "navigate" && urlMatch) {
      recovered.url = urlMatch[0];
    }
    if ((actionName === "click" || actionName === "type") && elementIdMatch) {
      recovered.elementId = elementIdMatch[0];
    }
    if (actionName === "press" && keyMatch) {
      recovered.key = keyMatch[0];
    }
    if (actionName === "wait" && msMatch) {
      recovered.ms = Number(msMatch[1]);
    }
    if (actionName === "finish") {
      recovered.summary = raw.trim();
    }
    if (actionName === "ask_user") {
      recovered.question = raw.trim();
    }

    return recovered;
  };

  let normalizedArgs: Record<string, unknown> = {};
  if (typeof decision.action.args === "string") {
    try {
      const parsed = JSON.parse(decision.action.args);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        normalizedArgs = parsed as Record<string, unknown>;
      } else {
        normalizedArgs = recoverArgsFromString(decision.action.name, decision.action.args);
      }
    } catch {
      normalizedArgs = recoverArgsFromString(decision.action.name, decision.action.args);
    }
  } else if (decision.action.args && typeof decision.action.args === "object" && !Array.isArray(decision.action.args)) {
    normalizedArgs = decision.action.args as Record<string, unknown>;
  }

  if (decision.action.name === "wait") {
    const rawMs = normalizedArgs.ms;
    const rawDuration = normalizedArgs.duration;
    if (typeof rawMs !== "number" && typeof rawDuration === "number" && Number.isFinite(rawDuration)) {
      normalizedArgs.ms = Math.max(0, Math.round(rawDuration <= 60 ? rawDuration * 1000 : rawDuration));
    }
  }

  return {
    ...decision,
    riskLevel: normalizeRiskLevel(decision.riskLevel),
    action: {
      ...decision.action,
      args: normalizedArgs
    }
  };
}

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
      return normalizeDecisionRisk(decisionSchema.parse(decision));
    } catch (error) {
      if (!this.runtimeConfig.agent.allowModelFallback || this.runtimeConfig.model.fallbackMode === "never") {
        throw error;
      }

      if (this.runtimeConfig.model.fallbackMode === "non_transient_only" && this.isTransientModelError(error)) {
        throw error;
      }
      const fallbackDecision = await this.fallback.decide(input);
      return normalizeDecisionRisk(decisionSchema.parse(fallbackDecision));
    }
  }

  private buildClient(provider: string, apiKey: string | undefined): ModelClient {
    if (provider === "openai_compatible") {
      return new OpenAICompatibleModelClient(this.runtimeConfig, apiKey);
    }

    if (provider === "anthropic_compatible") {
      return new AnthropicCompatibleModelClient(this.runtimeConfig, apiKey);
    }

    if (provider === "rule_based") {
      return new RuleBasedModelClient(this.runtimeConfig);
    }

    throw new Error(`Unsupported model provider: ${provider}`);
  }

  private isTransientModelError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return this.runtimeConfig.model.transientErrorKeywords.some((keyword) => message.includes(keyword.toLowerCase()));
  }
}

export function parseDecisionFromText(text: string): AgentDecision {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return normalizeDecisionRisk(decisionSchema.parse(JSON.parse(trimmed)));
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end === -1 || start >= end) {
    throw new Error("Model did not return JSON decision payload");
  }

  const extracted = trimmed.slice(start, end + 1);
  return normalizeDecisionRisk(decisionSchema.parse(JSON.parse(extracted)));
}
