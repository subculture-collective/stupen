/** Private canonical results only; no source snapshots or practice runs. */
export type Submission = {
  id: string;
  at: string;
  passed: boolean;
  durationMs: number;
  checks: {
    at: string;
    passed: boolean;
    sandboxed: boolean;
    results: { command: string; exitCode: number | null; output: string; durationMs: number; timedOut: boolean }[];
  };
  detailsTruncated: boolean;
};
export const SUBMISSION_LIMIT = 30;
export const SUBMISSION_DETAIL_CHARS = 12_000;
