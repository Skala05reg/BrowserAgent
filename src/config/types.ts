export type RiskLevel = "safe" | "sensitive" | "destructive" | "financial" | "external_send";
export type ConsoleLogLevel = "system" | "status" | "observation" | "decision" | "action" | "approval" | "success" | "warn" | "error";
export type ActionLogName = "navigate" | "click" | "type" | "press" | "scroll" | "wait" | "finish" | "ask_user";

export interface AgentConfig {
  maxSteps: number;
  maxHistoryItems: number;
  stepDelayMs: number;
  decisionRetryCount: number;
  allowModelFallback: boolean;
  defaultStartUrl: string;
  guards: AgentGuardsConfig;
}

export interface AgentGuardsConfig {
  enabled: boolean;
  recentActionWindow: number;
  maxRepeatedActionBeforeRewrite: number;
  maxRepeatedScrollBeforeHotkey: number;
  scrollBreakKeyUp: string;
  scrollBreakKeyDown: string;
}

export interface BrowserSnapshotConfig {
  maxElements: number;
  textExcerptLength: number;
  includeInputs: boolean;
  includeButtons: boolean;
  includeLinks: boolean;
  includeHeadings: boolean;
  onlyViewportElements: boolean;
  viewportMarginPx: number;
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
  navigationWaitUntil: "load" | "domcontentloaded" | "networkidle";
  actionTimeoutMs: number;
  waitAfterActionMs: number;
  clickFallbackToHrefOnTimeout: boolean;
  typeActionAllowedInputTypes: string[];
  snapshotWaitUntil: "load" | "domcontentloaded" | "networkidle";
  snapshotWaitTimeoutMs: number;
  adoptLatestPageOnNewTab: boolean;
  snapshot: BrowserSnapshotConfig;
}

export interface ModelConfig {
  provider: string;
  fallbackProvider: string;
  fallbackMode: "always" | "non_transient_only" | "never";
  apiBaseUrl: string;
  apiKeyEnv: string;
  modelNameEnv: string;
  providerEnv: string;
  baseUrlEnv: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  requestTimeoutMs: number;
  transientErrorKeywords: string[];
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
  visibleLevels: ConsoleLogLevel[];
  maxInlineValueLength: number;
  maxInlineArrayItems: number;
  maxInlineObjectKeys: number;
  maxInlineLineLength: number;
  neverTruncateKeys: string[];
  actionStartLogActions: ActionLogName[];
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
  nonTextInputPenalty: number;
  lowSignalElementPenalty: number;
}

export interface ContextLoopHintsConfig {
  historyWindow: number;
  repeatActionThreshold: number;
  sameUrlThreshold: number;
  failedActionHintLimit: number;
}

export interface ContextConfig {
  maxRankedElements: number;
  maxTextExcerptForModel: number;
  keywordMinLength: number;
  recentHistoryDepth: number;
  stopWords: string[];
  nonTextInputTypes: string[];
  loopHints: ContextLoopHintsConfig;
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
