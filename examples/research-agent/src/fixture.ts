/**
 * ILLUSTRATIVE FIXTURE — NOT LIVE RESEARCH (PRD §23.5).
 *
 * These entries are fabricated for demonstration and testing: the names are
 * placeholders and every URL uses a reserved `.example` / `example.com` domain.
 * No company here is real. A deterministic fixture is used so the demo is
 * reproducible; the evidence it produces is labelled `fixture: true`.
 */
export const FIXTURE_NOTICE =
  "Illustrative fixture data: fabricated entries on reserved example domains. Not live research and not real companies.";

export interface StartupRecord {
  name: string;
  website: string;
  foundedYear: number;
  sources: string[];
}

const entry = (i: number): StartupRecord => ({
  name: `Illustrative Startup ${i}`,
  website: `https://illustrative-startup-${i}.example.com`,
  foundedYear: 2025 + (i % 2),
  sources: [`https://directory-${(i % 3) + 1}.example.org/listing/${i}`],
});

/** A complete result: 10 qualifying entries. */
export const COMPLETE_RESULTS: StartupRecord[] = Array.from({ length: 10 }, (_, i) => entry(i + 1));

/** The deliberately incomplete result for the failed-validation demo: only 6 of 10. */
export const INCOMPLETE_RESULTS: StartupRecord[] = COMPLETE_RESULTS.slice(0, 6);
