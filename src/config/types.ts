export type RiskLevel = "safe" | "sensitive" | "destructive" | "financial" | "external_send";

export interface AgentConfig {
  maxSteps: number;
  maxHistoryItems: number;
  stepDelayMs: number;
  decisionRetryCount: number;
  allowModelFallback: boolean;
  defaultStartUrl: string;
}

export interface BrowserSnapshotConfig {
  maxElements: number;
  textExcerptLength: number;
  includeInputs: boolean;
  includeButtons: boolean;
  includeLinks: boolean;
  includeHeadings: boolean;
}

export interface BrowserConfig {
  headless: boolean;
  slowMoMs: number;
  viewport: {
    width: number;
    height: number;
  };
  userDataDir: string;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
  waitAfterActionMs: number;
  snapshot: BrowserSnapshotConfig;
}

export interface ModelConfig {
  provider: string;
  fallbackProvider: string;
  apiBaseUrl: string;
  apiKeyEnv: string;
  modelNameEnv: string;
  providerEnv: string;
  baseUrlEnv: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  requestTimeoutMs: number;
  connectionCheckSystemPrompt: string;
  connectionCheckUserPrompt: string;
  connectionCheckMaxTokens: number;
}

export interface SafetyConfig {
  requireConfirmationRiskLevels: RiskLevel[];
  keywordTriggers: string[];
}

export interface LoggingColorConfig {
  system: string;
  status: string;
  observation: string;
  decision: string;
  action: string;
  approval: string;
  success: string;
  warn: string;
  error: string;
}

export interface LoggingConsoleConfig {
  maxInlineValueLength: number;
  maxInlineArrayItems: number;
  maxInlineObjectKeys: number;
  maxInlineLineLength: number;
}

export interface LoggingConfig {
  jsonlPath: string;
  debugTextPath: string;
  showObservationDetails: boolean;
  timeFormat: "iso" | "locale";
  console: LoggingConsoleConfig;
  colors: LoggingColorConfig;
}

export interface CliConfig {
  banner: string[];
  prompt: string;
  unknownCommandMessage: string;
  busyMessage: string;
  idleMessage: string;
}

export interface PromptConfig {
  system: string;
  outputSchemaHint: string;
  actionPolicy: string;
}

export interface ContextScoreWeights {
  textMatch: number;
  ariaMatch: number;
  placeholderMatch: number;
  hrefMatch: number;
  interactiveRoleBonus: number;
  recentlyUsedBonus: number;
  disabledPenalty: number;
}

export interface ContextConfig {
  maxRankedElements: number;
  maxTextExcerptForModel: number;
  keywordMinLength: number;
  recentHistoryDepth: number;
  stopWords: string[];
  scoreWeights: ContextScoreWeights;
}

export interface SubAgentRoleConfig {
  navigator: string;
  extractor: string;
  action: string;
  verifier: string;
}

export interface SubAgentsConfig {
  enabled: boolean;
  roles: SubAgentRoleConfig;
}

export interface RecoveryConfig {
  enabled: boolean;
  retrySameActionOnTransientErrors: boolean;
  transientErrorKeywords: string[];
  popupDismissKey: string;
  waitMsAfterFailure: number;
  scrollRecoveryAmount: number;
  maxAutoRecoveryActions: number;
  maxConsecutiveFailuresBeforePause: number;
}

export interface RuntimeConfig {
  agent: AgentConfig;
  browser: BrowserConfig;
  model: ModelConfig;
  safety: SafetyConfig;
  logging: LoggingConfig;
  cli: CliConfig;
  prompts: PromptConfig;
  context: ContextConfig;
  subAgents: SubAgentsConfig;
  recovery: RecoveryConfig;
}
