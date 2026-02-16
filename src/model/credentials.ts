import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RuntimeConfig } from "../config/types.js";

interface ClaudeSettings {
  env?: Record<string, string>;
}

export interface AnthropicCredentials {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  source: "env" | "claude_settings";
}

function readClaudeSettings(): ClaudeSettings | null {
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  if (!fs.existsSync(settingsPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as ClaudeSettings;
    return parsed;
  } catch {
    return null;
  }
}

export function resolveAnthropicCredentials(runtimeConfig: RuntimeConfig, explicitApiKey?: string): AnthropicCredentials {
  const fromEnvApiKey = explicitApiKey ?? process.env.ANTHROPIC_AUTH_TOKEN;
  const fromEnvBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const fromEnvModel = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;

  if (fromEnvApiKey) {
    return {
      apiKey: fromEnvApiKey,
      baseUrl: fromEnvBaseUrl ?? runtimeConfig.model.apiBaseUrl,
      modelName: fromEnvModel ?? runtimeConfig.model.modelName,
      source: "env"
    };
  }

  const settings = readClaudeSettings();
  const settingsEnv = settings?.env;
  const settingsApiKey = settingsEnv?.ANTHROPIC_AUTH_TOKEN;
  const settingsBaseUrl = settingsEnv?.ANTHROPIC_BASE_URL;
  const settingsModel =
    settingsEnv?.ANTHROPIC_DEFAULT_SONNET_MODEL ?? settingsEnv?.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? settingsEnv?.ANTHROPIC_DEFAULT_OPUS_MODEL;

  if (!settingsApiKey) {
    throw new Error(
      `Missing anthropic token. Set ${runtimeConfig.model.apiKeyEnv} or ANTHROPIC_AUTH_TOKEN, or configure ~/.claude/settings.json`
    );
  }

  return {
    apiKey: settingsApiKey,
    baseUrl: settingsBaseUrl ?? runtimeConfig.model.apiBaseUrl,
    modelName: settingsModel ?? runtimeConfig.model.modelName,
    source: "claude_settings"
  };
}
