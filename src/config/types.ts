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

export interface LoggingConfig {
  jsonlPath: string;
  showObservationDetails: boolean;
  timeFormat: "iso" | "locale";
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

export interface RuntimeConfig {
  agent: AgentConfig;
  browser: BrowserConfig;
  model: ModelConfig;
  safety: SafetyConfig;
  logging: LoggingConfig;
  cli: CliConfig;
  prompts: PromptConfig;
  context: ContextConfig;
}
