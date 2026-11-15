import type { PracticeValue } from "./practice.ts";

export type PracticeRequest = { version: 1; cases: import("./practice.ts").PracticeCase[] };
export type PracticeCapability = { version: 1; runtimes: string[] };
export type PracticeResult = {
  id: string;
  status: "passed" | "failed" | "completed" | "compile_error" | "runtime_error" | "timeout" | "invalid_output" | "skipped";
  actual?: PracticeValue;
  stdout: string;
  stderr: string;
  durationMs: number;
  outputTruncated: boolean;
};
export type PracticeRun = { version: 1; sandboxed: true; durationMs: number; results: PracticeResult[] };
export const PRACTICE_REQUEST_BYTES = 262_144;
export const PRACTICE_RESPONSE_BYTES = 524_288;
export const PRACTICE_RESULT_BYTES = 65_536;
export const PRACTICE_LOG_BYTES = 16_384;

export function supportsPractice(value: unknown, runtime: string): boolean {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<PracticeCapability>;
  return p.version === 1 && Array.isArray(p.runtimes) && p.runtimes.every((r) => typeof r === "string") && p.runtimes.includes(runtime);
}
