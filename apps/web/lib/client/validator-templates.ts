/** One-click starting points for the validator builder. Each one is a working rule set plus a sample to try it on. */
export interface ValidatorTemplate {
  id: string;
  name: string;
  /** What kind of agent this fits, in plain words. */
  fits: string;
  slug: string;
  description: string;
  rules: unknown[];
  /** A sample RESULT that passes, so "Run test" shows green immediately and the user can then break it. */
  sample: unknown;
  evidenceTypes: string[];
  taskParameters: Record<string, unknown>;
}

export const VALIDATOR_TEMPLATES: ValidatorTemplate[] = [
  {
    id: "research-brief",
    name: "Cited research brief",
    fits: "Agents that research a topic and return a summary with sources (the sample research agent uses this).",
    slug: "research-brief",
    description: "A brief with a topic, a summary and several distinct, well-formed findings from known sources.",
    rules: [
      { type: "required_fields", path: "$", fields: ["topic", "summary", "findings"] },
      { type: "field_format", path: "$.summary", format: "non_empty_string" },
      { type: "items", path: "$.findings", min: { param: "minimumFindings", default: 3 } },
      { type: "required_fields", path: "$.findings[*]", fields: ["title", "url", "snippet"] },
      { type: "field_format", path: "$.findings[*].url", format: "http_url" },
      { type: "unique", path: "$.findings[*].url" },
      { type: "evidence", types: ["tool_call", "tool_result"] },
    ],
    sample: {
      topic: "solid state batteries",
      summary: "Solid-state batteries replace the liquid electrolyte with a solid one [1].",
      findings: [
        { title: "Solid-state battery", url: "https://en.wikipedia.org/wiki/Solid-state_battery", snippet: "A solid-state battery uses a solid electrolyte." },
        { title: "Solid-state electrolyte", url: "https://en.wikipedia.org/wiki/Solid-state_electrolyte", snippet: "A solid ionic conductor." },
        { title: "Toyota solid-state battery", url: "https://www.topspeed.com/toyota-745-mile-solid-state-battery/", snippet: "Range claims for EVs." },
      ],
    },
    evidenceTypes: ["task", "tool_call", "tool_result", "result"],
    taskParameters: { minimumFindings: 3 },
  },
  {
    id: "record-list",
    name: "List of records",
    fits: "Agents that return a list of things: leads, companies, products, listings.",
    slug: "record-list",
    description: "A list with enough entries, each complete, with no duplicates.",
    rules: [
      { type: "items", path: "$", min: { param: "minimumResults", default: 5 } },
      { type: "required_fields", path: "$[*]", fields: ["name", "url"] },
      { type: "field_format", path: "$[*].url", format: "http_url" },
      { type: "unique", path: "$[*].url" },
      { type: "evidence", types: ["tool_call", "tool_result"] },
    ],
    sample: [
      { name: "Acme", url: "https://acme.example.com" },
      { name: "Beta", url: "https://beta.example.com" },
      { name: "Gamma", url: "https://gamma.example.com" },
      { name: "Delta", url: "https://delta.example.com" },
      { name: "Epsilon", url: "https://epsilon.example.com" },
    ],
    evidenceTypes: ["task", "tool_call", "tool_result", "result"],
    taskParameters: { minimumResults: 5 },
  },
  {
    id: "extraction",
    name: "Structured data extraction",
    fits: "Agents that pull fields out of documents: invoices, forms, emails, contracts.",
    slug: "invoice-extraction",
    description: "Every required field is present and well-formed, with sane amounts and an allowed currency.",
    rules: [
      { type: "required_fields", path: "$", fields: ["vendor", "invoiceNumber", "date", "total", "currency"] },
      { type: "field_format", path: "$.date", format: "iso_date" },
      { type: "number_range", path: "$.total", min: 0 },
      { type: "one_of", path: "$.currency", values: ["USD", "EUR", "GBP"] },
      { type: "evidence", types: ["tool_call", "tool_result"] },
    ],
    sample: { vendor: "Acme Supplies", invoiceNumber: "INV-2041", date: "2026-09-30", total: 1280.5, currency: "USD" },
    evidenceTypes: ["task", "tool_call", "tool_result", "result"],
    taskParameters: {},
  },
  {
    id: "classification",
    name: "Classification",
    fits: "Agents that label things: support tickets, documents, sentiment, routing.",
    slug: "ticket-classifier",
    description: "A label from a fixed set, with a confidence between 0 and 1.",
    rules: [
      { type: "required_fields", path: "$", fields: ["label", "confidence"] },
      { type: "one_of", path: "$.label", values: ["billing", "bug", "feature_request", "other"] },
      { type: "number_range", path: "$.confidence", min: 0, max: 1 },
      { type: "evidence", types: ["model_output"] },
    ],
    sample: { label: "bug", confidence: 0.92 },
    evidenceTypes: ["task", "model_output", "result"],
    taskParameters: {},
  },
  {
    id: "answer-with-sources",
    name: "Answer with sources",
    fits: "Question-answering agents that must back every answer with references.",
    slug: "cited-answer",
    description: "A non-empty answer and at least one valid, distinct source URL.",
    rules: [
      { type: "required_fields", path: "$", fields: ["answer", "sources"] },
      { type: "field_format", path: "$.answer", format: "non_empty_string" },
      { type: "items", path: "$.sources", min: 1 },
      { type: "field_format", path: "$.sources[*]", format: "http_url" },
      { type: "unique", path: "$.sources[*]" },
      { type: "evidence", types: ["tool_call", "tool_result"] },
    ],
    sample: { answer: "The capital of France is Paris.", sources: ["https://en.wikipedia.org/wiki/Paris"] },
    evidenceTypes: ["task", "tool_call", "tool_result", "result"],
    taskParameters: {},
  },
  {
    id: "tool-audit",
    name: "Tool-use audit",
    fits: "Agents where what matters is that the work was actually done: it must have called its tools.",
    slug: "did-the-work",
    description: "The run recorded real tool calls and results and produced a non-empty result.",
    rules: [
      { type: "evidence", types: ["tool_call", "tool_result"] },
      { type: "evidence_count", min: 3 },
      { type: "required_fields", path: "$", fields: ["output"] },
    ],
    sample: { output: "done" },
    evidenceTypes: ["task", "tool_call", "tool_result", "result"],
    taskParameters: {},
  },
];
