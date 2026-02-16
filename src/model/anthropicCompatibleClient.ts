import { RuntimeConfig } from "../config/types.js";
import { AgentDecision } from "../core/types.js";
import { resolveAnthropicCredentials } from "./credentials.js";
import { DecisionInput, ModelClient, parseDecisionFromText } from "./modelGateway.js";

interface AnthropicMessageResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
}

export class AnthropicCompatibleModelClient implements ModelClient {
  public constructor(private readonly runtimeConfig: RuntimeConfig, private readonly apiKey: string | undefined) {}

  public async decide(input: DecisionInput): Promise<AgentDecision> {
    const creds = resolveAnthropicCredentials(this.runtimeConfig, this.apiKey);
    const endpoint = `${creds.baseUrl.replace(/\/$/, "")}/v1/messages`;

    const body = {
      model: creds.modelName,
      max_tokens: this.runtimeConfig.model.maxTokens,
      temperature: this.runtimeConfig.model.temperature,
      system: [
        this.runtimeConfig.prompts.system,
        this.runtimeConfig.prompts.actionPolicy,
        `Активная роль текущего шага: ${input.route.role}. Инструкция роли: ${input.route.roleInstruction}`,
        this.runtimeConfig.prompts.outputSchemaHint
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: this.buildUserPrompt(input)
            }
          ]
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
          "anthropic-version": "2023-06-01",
          "x-api-key": creds.apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Model request failed: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as AnthropicMessageResponse;
      const rawText =
        data.content
          ?.filter((item) => item.type === "text")
          .map((item) => item.text ?? "")
          .join("\n")
          .trim() ?? "";

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
      `<sub_agent role="${input.route.role}" rationale="${input.route.rationale}">${input.route.roleInstruction}</sub_agent>`,
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
