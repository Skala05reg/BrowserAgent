import { RiskLevel } from "../config/types.js";

export type AgentActionName = "navigate" | "click" | "type" | "press" | "scroll" | "wait" | "finish" | "ask_user";

export interface AgentAction {
  name: AgentActionName;
  args: Record<string, unknown>;
}

export interface AgentDecision {
  thoughtSummary: string;
  reasoning: string;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  successCriteria: string;
  action: AgentAction;
}

export interface AgentHistoryItem {
  step: number;
  decision: AgentDecision;
  actionResult: string;
  actionSucceeded: boolean;
  observedUrl: string;
  observedTitle: string;
}

export interface PageElementDescriptor {
  id: string;
  tag: string;
  role: string;
  text: string;
  placeholder: string;
  ariaLabel: string;
  href: string;
  value: string;
  disabled: boolean;
  inputType?: string;
  name?: string;
  inViewport?: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  textExcerpt: string;
  elements: PageElementDescriptor[];
}

export interface ToolExecutionResult {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export interface PendingApproval {
  requestId: string;
  step: number;
  reason: string;
  decision: AgentDecision;
}

export interface AgentTaskResult {
  status: "completed" | "stopped" | "failed";
  summary: string;
  stepsExecuted: number;
}
