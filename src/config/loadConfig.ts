import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config as dotenvConfig } from "dotenv";
import { RuntimeConfig } from "./types.js";

const runtimeSchema = z.object({
  agent: z.object({
    maxSteps: z.number().int().positive(),
    maxRunMs: z.number().int().positive(),
    maxHistoryItems: z.number().int().positive(),
    stepDelayMs: z.number().int().nonnegative(),
    snapshotRetryDelayMs: z.number().int().positive(),
    decisionRetryCount: z.number().int().nonnegative(),
    decisionRetryBaseDelayMs: z.number().int().nonnegative(),
    decisionRetryBackoffMultiplier: z.number().min(1),
    decisionRetryJitterRatio: z.number().min(0).max(1),
    maxDecisionRetryDelayMs: z.number().int().positive(),
    slowStepWarnMs: z.number().int().positive(),
    allowModelFallback: z.boolean(),
    defaultStartUrl: z.string().min(1),
    guards: z.object({
      enabled: z.boolean(),
      recentActionWindow: z.number().int().positive(),
      maxRepeatedActionBeforeRewrite: z.number().int().positive(),
      maxRepeatedScrollBeforeHotkey: z.number().int().positive(),
      scrollBreakKeyUp: z.string().min(1),
      scrollBreakKeyDown: z.string().min(1)
    })
  }),
  browser: z.object({
    headless: z.boolean(),
    slowMoMs: z.number().int().nonnegative(),
    viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
    userDataDir: z.string().min(1),
    navigationTimeoutMs: z.number().int().positive(),
    navigationWaitUntil: z.enum(["load", "domcontentloaded", "networkidle"]),
    actionTimeoutMs: z.number().int().positive(),
    waitAfterActionMs: z.number().int().nonnegative(),
    typeDelayMs: z.number().int().nonnegative(),
    defaultScrollAmountPx: z.number().int().positive(),
    clickFallbackToHrefOnTimeout: z.boolean(),
    typeActionAllowedInputTypes: z.array(z.string().min(1)),
    actionLimits: z.object({
      maxTypeTextLength: z.number().int().positive(),
      maxScrollAmountPx: z.number().int().positive(),
      maxWaitMs: z.number().int().positive(),
      allowedNavigationProtocols: z.array(z.string().min(1)).min(1),
      blockedHostPatterns: z.array(z.string().min(1)),
      allowPrivateNetworkHosts: z.boolean()
    }),
    snapshotWaitUntil: z.enum(["load", "domcontentloaded", "networkidle"]),
    snapshotWaitTimeoutMs: z.number().int().positive(),
    adoptLatestPageOnNewTab: z.boolean(),
    snapshot: z.object({
      maxElements: z.number().int().positive(),
      textExcerptLength: z.number().int().positive(),
      includeInputs: z.boolean(),
      includeButtons: z.boolean(),
      includeLinks: z.boolean(),
      includeHeadings: z.boolean(),
      onlyViewportElements: z.boolean(),
      viewportMarginPx: z.number().int().nonnegative()
    })
  }),
  model: z.object({
    provider: z.string().min(1),
    fallbackProvider: z.string().min(1),
    fallbackMode: z.enum(["always", "non_transient_only", "never"]),
    apiBaseUrl: z.string().url(),
    apiKeyEnv: z.string().min(1),
    modelNameEnv: z.string().min(1),
    providerEnv: z.string().min(1),
    baseUrlEnv: z.string().min(1),
    modelName: z.string().min(1),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().positive(),
    requestTimeoutMs: z.number().int().positive(),
    transientErrorKeywords: z.array(z.string().min(1)),
    connectionCheckSystemPrompt: z.string().min(1),
    connectionCheckUserPrompt: z.string().min(1),
    connectionCheckMaxTokens: z.number().int().positive(),
    promptLimits: z.object({
      maxHistoryItems: z.number().int().positive(),
      maxActionResultLength: z.number().int().positive(),
      maxThoughtSummaryLength: z.number().int().positive(),
      maxReasoningLength: z.number().int().positive(),
      maxAttentionHints: z.number().int().positive(),
      maxElementReasons: z.number().int().positive()
    }),
    circuitBreaker: z.object({
      enabled: z.boolean(),
      failureThreshold: z.number().int().positive(),
      cooldownMs: z.number().int().positive(),
      tripOnTransientOnly: z.boolean()
    })
  }),
  safety: z.object({
    requireConfirmationRiskLevels: z.array(z.enum(["safe", "sensitive", "destructive", "financial", "external_send"])),
    keywordTriggers: z.array(z.string().min(1))
  }),
  logging: z.object({
    jsonlPath: z.string().min(1),
    debugTextPath: z.string().min(1),
    jsonlIncludeMonitorData: z.boolean(),
    jsonlIncludeDebugData: z.boolean(),
    showObservationDetails: z.boolean(),
    timeFormat: z.enum(["iso", "locale"]),
    redaction: z.object({
      enabled: z.boolean(),
      keys: z.array(z.string().min(1)),
      mask: z.string().min(1)
    }),
    console: z.object({
      visibleLevels: z.array(z.enum(["system", "status", "observation", "decision", "action", "approval", "success", "warn", "error"])),
      maxInlineValueLength: z.number().int().positive(),
      maxInlineArrayItems: z.number().int().positive(),
      maxInlineObjectKeys: z.number().int().positive(),
      maxInlineLineLength: z.number().int().positive(),
      neverTruncateKeys: z.array(z.string().min(1)),
      actionStartLogActions: z.array(z.enum(["navigate", "click", "type", "press", "scroll", "wait", "finish", "ask_user"])),
      decisionDigest: z.object({
        enabled: z.boolean(),
        mode: z.enum(["always", "on_change"]),
        repeatReminderEvery: z.number().int().positive(),
        thoughtMaxLength: z.number().int().positive(),
        reasoningMaxLength: z.number().int().positive(),
        successCriteriaMaxLength: z.number().int().positive()
      })
    }),
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
    nonTextInputTypes: z.array(z.string().min(1)),
    loopHints: z.object({
      historyWindow: z.number().int().positive(),
      repeatActionThreshold: z.number().int().positive(),
      sameUrlThreshold: z.number().int().positive(),
      failedActionHintLimit: z.number().int().positive()
    }),
    scoreWeights: z.object({
      textMatch: z.number(),
      ariaMatch: z.number(),
      placeholderMatch: z.number(),
      hrefMatch: z.number(),
      interactiveRoleBonus: z.number(),
      recentlyUsedBonus: z.number(),
      repeatedRecentUsePenalty: z.number(),
      recentlyFailedPenalty: z.number(),
      nonMainRegionPenalty: z.number(),
      disabledPenalty: z.number(),
      nonTextInputPenalty: z.number(),
      lowSignalElementPenalty: z.number()
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
  }),
  recovery: z.object({
    enabled: z.boolean(),
    retrySameActionOnTransientErrors: z.boolean(),
    transientErrorKeywords: z.array(z.string().min(1)),
    popupDismissKey: z.string().min(1),
    waitMsAfterFailure: z.number().int().nonnegative(),
    maxWaitMsAfterFailure: z.number().int().positive(),
    backoffMultiplier: z.number().min(1),
    jitterRatio: z.number().min(0).max(1),
    scrollRecoveryAmount: z.number().int().nonnegative(),
    maxAutoRecoveryActions: z.number().int().positive(),
    maxConsecutiveFailuresBeforePause: z.number().int().positive()
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
