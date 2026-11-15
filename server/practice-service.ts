import { supportsPractice } from "../shared/practiceRun.ts";
import * as exec from "./exec.ts";
import { validatePracticeRequest } from "./practice-run.ts";
import { getLesson, getTrack, lessonDir, lessonFiles } from "./store.ts";
import { HttpError } from "./util.ts";

const running = new Set<string>();

async function context(user: string, trackId: string, lesson: string) {
  const track = await getTrack(user, trackId);
  const meta = await getLesson(user, trackId, lesson);
  if (!meta.practice || track.customCommand || !["typescript", "javascript", "python", "go"].includes(track.runner)) throw new HttpError(422, "This lesson keeps ordinary checks; editable-case execution is not supported.");
  return { track, practice: meta.practice };
}

export async function practiceAvailability(user: string, trackId: string, lesson: string) {
  try {
    const { track } = await context(user, trackId, lesson);
    const enabled = supportsPractice((await exec.status()).practice, track.runner);
    return { enabled, reason: enabled ? "" : "This runner needs matching practice support, its language toolchain and a working sandbox. Ordinary checks remain available." };
  } catch (e) {
    if ((e as HttpError).status !== 422) throw e;
    return { enabled: false, reason: (e as Error).message };
  }
}

/** Read-only with respect to all lesson progress, coaching, cases and canonical tests. */
export async function practiceLesson(user: string, trackId: string, lesson: string, input: unknown, signal?: AbortSignal) {
  if (running.has(user)) throw new HttpError(429, "A practice run is already in progress for your account.");
  running.add(user);
  try {
    const { track, practice } = await context(user, trackId, lesson);
    const request = validatePracticeRequest(input, practice);
    return await exec.practice(lessonDir(user, trackId, lesson), track.runner, practice, await lessonFiles(user, trackId, lesson), request, signal);
  } finally { running.delete(user); }
}
