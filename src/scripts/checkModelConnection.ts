import { loadModelApiKey, loadRuntimeConfig } from "../config/loadConfig.js";
import { resolveAnthropicCredentials } from "../model/credentials.js";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type: string; text?: string }>;
    };
  }>;
}

interface AnthropicMessageResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
}

function extractText(data: ChatCompletionResponse): string {
  const messageContent = data.choices?.at(0)?.message?.content;
  if (typeof messageContent === "string") {
    return messageContent.trim();
  }
  if (Array.isArray(messageContent)) {
    return messageContent
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n")
      .trim();
  }
  return "";
}

async function run(): Promise<void> {
  const config = loadRuntimeConfig();
  const apiKey = loadModelApiKey(config);

  if (config.model.provider === "openai_compatible") {
    await runOpenAICompatibleCheck(config, apiKey);
    return;
  }

  if (config.model.provider === "anthropic_compatible") {
    await runAnthropicCompatibleCheck(config, apiKey);
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`MODEL_PROVIDER=${config.model.provider}. Unsupported provider for model:check.`);
}

async function runOpenAICompatibleCheck(config: ReturnType<typeof loadRuntimeConfig>, apiKey: string | undefined): Promise<void> {
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.error(`Missing ${config.model.apiKeyEnv}. Укажи его в .env и повтори npm run model:check`);
    process.exit(1);
  }

  const endpoint = `${config.model.apiBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: config.model.modelName,
    temperature: 0,
    max_tokens: config.model.connectionCheckMaxTokens,
    messages: [
      {
        role: "system",
        content: config.model.connectionCheckSystemPrompt
      },
      {
        role: "user",
        content: config.model.connectionCheckUserPrompt
      }
    ]
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.model.requestTimeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const reply = extractText(data);

    // eslint-disable-next-line no-console
    console.log("MODEL CHECK OK");
    // eslint-disable-next-line no-console
    console.log(`provider=${config.model.provider}`);
    // eslint-disable-next-line no-console
    console.log(`model=${config.model.modelName}`);
    // eslint-disable-next-line no-console
    console.log(`endpoint=${endpoint}`);
    // eslint-disable-next-line no-console
    console.log(`reply=${reply}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("MODEL CHECK FAILED");
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    clearTimeout(timeout);
  }
}

async function runAnthropicCompatibleCheck(config: ReturnType<typeof loadRuntimeConfig>, apiKey: string | undefined): Promise<void> {
  const creds = resolveAnthropicCredentials(config, apiKey);
  const endpoint = `${creds.baseUrl.replace(/\/$/, "")}/v1/messages`;

  const body = {
    model: creds.modelName,
    max_tokens: config.model.connectionCheckMaxTokens,
    temperature: 0,
    system: config.model.connectionCheckSystemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: config.model.connectionCheckUserPrompt
          }
        ]
      }
    ]
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.model.requestTimeoutMs);

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
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const data = (await response.json()) as AnthropicMessageResponse;
    const reply =
      data.content
        ?.filter((item) => item.type === "text")
        .map((item) => item.text ?? "")
        .join("\n")
        .trim() ?? "";

    // eslint-disable-next-line no-console
    console.log("MODEL CHECK OK");
    // eslint-disable-next-line no-console
    console.log(`provider=${config.model.provider}`);
    // eslint-disable-next-line no-console
    console.log(`model=${creds.modelName}`);
    // eslint-disable-next-line no-console
    console.log(`endpoint=${endpoint}`);
    // eslint-disable-next-line no-console
    console.log(`credential_source=${creds.source}`);
    // eslint-disable-next-line no-console
    console.log(`reply=${reply}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("MODEL CHECK FAILED");
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    clearTimeout(timeout);
  }
}

void run();
