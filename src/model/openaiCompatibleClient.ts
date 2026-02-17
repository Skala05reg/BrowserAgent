import { RuntimeConfig } from "../config/types.js";
import { AgentDecision } from "../core/types.js";
import { DecisionInput, ModelClient, parseDecisionFromText } from "./modelGateway.js";
import { buildDecisionUserPrompt } from "./promptBuilder.js";

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
            `Активная роль текущего шага: ${input.route.role}. Инструкция роли: ${input.route.roleInstruction}`,
            this.runtimeConfig.prompts.outputSchemaHint
          ].join("\n")
        },
        {
          role: "user",
          content: buildDecisionUserPrompt(input)
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
}
