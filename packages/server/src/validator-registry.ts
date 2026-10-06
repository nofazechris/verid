import type { EvidenceCommitmentInput, ValidationResult } from "@verid/core";
import {
  RESEARCH_VALIDATOR_ID,
  RESEARCH_VALIDATOR_RULES,
  RESEARCH_VALIDATOR_VERSION,
  validateResearch,
} from "@verid/validators";

export interface ValidatorRunInput {
  executionId: string;
  result: unknown;
  evidence: EvidenceCommitmentInput[];
  /** The task's `parameters` object (untrusted JSON). */
  taskParameters: Record<string, unknown>;
  validatedAt: string;
}

export interface RegisteredValidator {
  id: string;
  version: string;
  name: string;
  method: string;
  description: string;
  supportedTasks: string;
  /** Human-readable rules, shown on the validators page so users can see what is checked. */
  rules: readonly string[];
  run(input: ValidatorRunInput): ValidationResult;
}

const positiveInt = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 10_000 ? v : undefined;
const year = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 1900 && v <= 3000 ? v : undefined);

const research: RegisteredValidator = {
  id: RESEARCH_VALIDATOR_ID,
  version: RESEARCH_VALIDATOR_VERSION,
  name: "ResearchValidator",
  method: "Deterministic structural verification",
  description:
    "Checks that a research result is complete, well-formed and internally consistent. It does not confirm that any entry is factually true.",
  supportedTasks: "Research tasks returning a list of {name, website, foundedYear, sources}",
  rules: RESEARCH_VALIDATOR_RULES,
  run: (i) =>
    validateResearch(
      { executionId: i.executionId, result: i.result, evidence: i.evidence, validatedAt: i.validatedAt },
      { minimumResults: positiveInt(i.taskParameters.minimumResults), foundedAfter: year(i.taskParameters.foundedAfter) },
    ),
};

export const VALIDATORS: readonly RegisteredValidator[] = [research];

export function findValidator(id: string): RegisteredValidator | undefined {
  return VALIDATORS.find((v) => v.id === id);
}
