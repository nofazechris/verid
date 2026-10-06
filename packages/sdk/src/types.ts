export type EvidenceType = "task" | "tool_call" | "tool_result" | "model_output" | "artifact";
export type ValidationStatus = "pass" | "fail" | "inconclusive";
export type Health = "no_runs" | "healthy" | "degraded" | "failing";
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export interface Task {
  description: string;
  parameters?: Record<string, Json>;
}

export interface Agent {
  id: string;
  slug: string;
  name: string;
  version: string;
  description: string | null;
  capabilities: string[];
  status: "active" | "inactive";
  executions?: number;
  validated?: number;
  lastExecutionAt?: string | null;
  monitoring?: Monitoring;
}

export interface Monitoring {
  health: Health;
  healthReason: string;
  recentPassRate: number | null;
  recentRuns: number;
  last24h: number;
  stuckRuns: number;
  lastRunAt: string | null;
  [k: string]: unknown;
}

export interface Execution {
  id: string;
  status: string;
  taskHash: string;
  [k: string]: unknown;
}

export interface Check {
  id: string;
  description: string;
  ok: boolean;
  determinate: boolean;
  explanation?: string;
}

export interface Validation {
  id: string;
  status: ValidationStatus;
  validatorId: string;
  validatorVersion: string;
  checks: Check[];
  resultHash: string;
}

export interface Receipt {
  receiptId: string;
  executionId: string;
  receiptHash: string;
  [k: string]: unknown;
}

export interface Anchor {
  status: "submitted" | "confirmed" | "reverted";
  network: string;
  chainId: number;
  transactionHash: string | null;
  blockNumber: number | null;
}

export interface ValidatorDefinition {
  slug: string;
  name: string;
  description?: string;
  rules: unknown[];
}

export interface ValidatorInfo {
  id: string;
  name: string;
  origin: "verid" | "workspace";
  version: number | string;
  rules: string[];
  [k: string]: unknown;
}

export interface Settlement {
  status: "escrowed" | "released" | "refunded" | "failed";
  amount: string;
  [k: string]: unknown;
}
