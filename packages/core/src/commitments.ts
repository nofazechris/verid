import type { JsonValue } from "./canonical";
import { DOMAIN, ZERO_HASH, commit, keccak, utf8ToBytes, type Hex32 } from "./hash";

export interface TaskDefinition {
  description: string;
  parameters?: Record<string, JsonValue>;
  /** JSON-Schema-like description of the required output. */
  outputSchema?: Record<string, JsonValue>;
  acceptanceCriteria?: string[];
  /** Task schema version. */
  version?: number;
}

export interface PolicyDefinition {
  /** Human-readable policy identifier, e.g. "research-policy". */
  id: string;
  version: number;
  rules: Record<string, JsonValue>;
}

export const hashTask = (task: TaskDefinition): Hex32 => commit(DOMAIN.task, task);
export const hashPolicy = (policy: PolicyDefinition): Hex32 => commit(DOMAIN.policy, policy);
/** Commitment to a workspace-defined validator's rules (see @verid/validators `RuleDefinition`). */
export const hashValidatorRules = (def: JsonValue): Hex32 => commit(DOMAIN.validatorRules, def);
export const hashResult = (result: JsonValue): Hex32 => commit(DOMAIN.result, result);

/**
 * Onchain identifier for an execution: keccak256(domain || 0x00 || executionId).
 * Binding the execution ID string to a fixed-width bytes32 key keeps registry
 * lookups cheap while remaining reproducible by any verifier.
 */
export function executionKey(executionId: string): Hex32 {
  return keccak(new Uint8Array([...utf8ToBytes(DOMAIN.executionId), 0, ...utf8ToBytes(executionId)]));
}

export const NO_POLICY: Hex32 = ZERO_HASH;
