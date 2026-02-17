import { RuntimeConfig } from "../config/types.js";
import { AgentDecision } from "../core/types.js";
import { resolveAnthropicCredentials } from "./credentials.js";
import { DecisionInput, ModelClient, parseDecisionFromText } from "./modelGateway.js";
import { buildDecisionUserPrompt } from "./promptBuilder.js";

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
              text: buildDecisionUserPrompt(input)
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
}
