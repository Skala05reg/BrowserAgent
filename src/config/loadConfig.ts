import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config as dotenvConfig } from "dotenv";
import { RuntimeConfig } from "./types.js";

const runtimeSchema = z.object({
  agent: z.object({
    maxSteps: z.number().int().positive(),
    maxHistoryItems: z.number().int().positive(),
    stepDelayMs: z.number().int().nonnegative(),
    decisionRetryCount: z.number().int().nonnegative(),
    allowModelFallback: z.boolean(),
    defaultStartUrl: z.string().min(1)
  }),
  browser: z.object({
    headless: z.boolean(),
    slowMoMs: z.number().int().nonnegative(),
    viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
    userDataDir: z.string().min(1),
    navigationTimeoutMs: z.number().int().positive(),
    actionTimeoutMs: z.number().int().positive(),
    waitAfterActionMs: z.number().int().nonnegative(),
    snapshot: z.object({
      maxElements: z.number().int().positive(),
      textExcerptLength: z.number().int().positive(),
      includeInputs: z.boolean(),
      includeButtons: z.boolean(),
      includeLinks: z.boolean(),
      includeHeadings: z.boolean()
    })
  }),
  model: z.object({
    provider: z.string().min(1),
    fallbackProvider: z.string().min(1),
    apiBaseUrl: z.string().url(),
    apiKeyEnv: z.string().min(1),
    modelNameEnv: z.string().min(1),
    providerEnv: z.string().min(1),
    baseUrlEnv: z.string().min(1),
    modelName: z.string().min(1),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().positive(),
    requestTimeoutMs: z.number().int().positive()
  }),
  safety: z.object({
    requireConfirmationRiskLevels: z.array(z.enum(["safe", "sensitive", "destructive", "financial", "external_send"])),
    keywordTriggers: z.array(z.string().min(1))
  }),
  logging: z.object({
    jsonlPath: z.string().min(1),
    showObservationDetails: z.boolean(),
    timeFormat: z.enum(["iso", "locale"]),
    colors: z.object({
      system: z.string().min(1),
      status: z.string().min(1),
      observation: z.string().min(1),
      decision: z.string().min(1),
      action: z.string().min(1),
      approval: z.string().min(1),
      success: z.string().min(1),
      warn: z.string().min(1),
      error: z.string().min(1)
    })
  }),
  cli: z.object({
    banner: z.array(z.string()),
    prompt: z.string().min(1),
    unknownCommandMessage: z.string().min(1),
    busyMessage: z.string().min(1),
    idleMessage: z.string().min(1)
  }),
  prompts: z.object({
    system: z.string().min(1),
    outputSchemaHint: z.string().min(1),
    actionPolicy: z.string().min(1)
  }),
  context: z.object({
    maxRankedElements: z.number().int().positive(),
    maxTextExcerptForModel: z.number().int().positive(),
    keywordMinLength: z.number().int().positive(),
    recentHistoryDepth: z.number().int().positive(),
    stopWords: z.array(z.string().min(1)),
    scoreWeights: z.object({
      textMatch: z.number(),
      ariaMatch: z.number(),
      placeholderMatch: z.number(),
      hrefMatch: z.number(),
      interactiveRoleBonus: z.number(),
      recentlyUsedBonus: z.number(),
      disabledPenalty: z.number()
    })
  }),
  subAgents: z.object({
    enabled: z.boolean(),
    roles: z.object({
      navigator: z.string().min(1),
      extractor: z.string().min(1),
      action: z.string().min(1),
      verifier: z.string().min(1)
    })
  })
});

function resolveConfigPath(): string {
  const configured = process.env.AGENT_CONFIG_PATH;
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(process.cwd(), "config/default.json");
}

export function loadRuntimeConfig(): RuntimeConfig {
  dotenvConfig();

  const configPath = resolveConfigPath();
  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = runtimeSchema.parse(JSON.parse(raw));

  const providerOverride = process.env[parsed.model.providerEnv];
  const modelNameOverride = process.env[parsed.model.modelNameEnv];
  const baseUrlOverride = process.env[parsed.model.baseUrlEnv];

  return {
    ...parsed,
    model: {
      ...parsed.model,
      provider: providerOverride ?? parsed.model.provider,
      modelName: modelNameOverride ?? parsed.model.modelName,
      apiBaseUrl: baseUrlOverride ?? parsed.model.apiBaseUrl
    }
  };
}

export function loadModelApiKey(config: RuntimeConfig): string | undefined {
  return process.env[config.model.apiKeyEnv];
}
