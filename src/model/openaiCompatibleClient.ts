import { RuntimeConfig } from "../config/types.js";
import { AgentDecision } from "../core/types.js";
import { DecisionInput, ModelClient, parseDecisionFromText } from "./modelGateway.js";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type: string; text?: string }>;
    };
  }>;
}

export class OpenAICompatibleModelClient implements ModelClient {
  public constructor(private readonly runtimeConfig: RuntimeConfig, private readonly apiKey: string | undefined) {}

  public async decide(input: DecisionInput): Promise<AgentDecision> {
    if (!this.apiKey) {
      throw new Error(
        `Missing API key in env var ${this.runtimeConfig.model.apiKeyEnv}. Configure it in .env before using openai_compatible provider.`
      );
    }

    const endpoint = `${this.runtimeConfig.model.apiBaseUrl.replace(/\/$/, "")}/chat/completions`;
    const body = {
      model: this.runtimeConfig.model.modelName,
      temperature: this.runtimeConfig.model.temperature,
      max_tokens: this.runtimeConfig.model.maxTokens,
      messages: [
        {
          role: "system",
          content: [
            this.runtimeConfig.prompts.system,
            this.runtimeConfig.prompts.actionPolicy,
            this.runtimeConfig.prompts.outputSchemaHint
          ].join("\n")
        },
        {
          role: "user",
          content: this.buildUserPrompt(input)
        }
      ]
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.runtimeConfig.model.requestTimeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Model request failed: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const messageContent = data.choices?.at(0)?.message?.content;

      let rawText = "";
      if (typeof messageContent === "string") {
        rawText = messageContent;
      } else if (Array.isArray(messageContent)) {
        rawText = messageContent
          .filter((item) => item.type === "text")
          .map((item) => item.text ?? "")
          .join("\n")
          .trim();
      }

      if (!rawText) {
        throw new Error("Empty model response");
      }

      return parseDecisionFromText(rawText);
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildUserPrompt(input: DecisionInput): string {
    const compactElements = input.contextPacket.rankedElements.map((item) => ({
      id: item.id,
      role: item.role,
      text: item.text,
      placeholder: item.placeholder,
      ariaLabel: item.ariaLabel,
      href: item.href,
      disabled: item.disabled,
      score: item.score,
      reasons: item.reasons
    }));

    const compactHistory = input.history.map((item) => ({
      step: item.step,
      action: item.decision.action,
      result: item.actionResult,
      thoughtSummary: item.decision.thoughtSummary,
      risk: item.decision.riskLevel
    }));

    return [
      `<task>${input.task}</task>`,
      `<step>${input.step}</step>`,
      `<page url="${input.snapshot.url}" title="${input.snapshot.title}">`,
      `<summary>${input.contextPacket.pageSummary}</summary>`,
      `<attention_hints>${JSON.stringify(input.contextPacket.attentionHints)}</attention_hints>`,
      `<elements>${JSON.stringify(compactElements)}</elements>`,
      `<compression>${JSON.stringify(input.contextPacket.compression)}</compression>`,
      `</page>`,
      `<history>${JSON.stringify(compactHistory)}</history>`,
      "Ответ верни JSON-объектом с полями: thoughtSummary, reasoning, riskLevel, requiresConfirmation, successCriteria, action{name,args}."
    ].join("\n");
  }
}
