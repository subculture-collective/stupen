export type SourceFile = { path: string; content: string };
export type CodeProblem = { path: string; from: number; to: number; message: string; severity: "error" | "warning"; source: string };
export type CodeCompletion = { label: string; type: string; detail?: string; info?: string; from?: number; to?: number; insert?: string };
export type CodeHover = { from: number; to: number; signature: string; documentation: string };
export type LanguageRequest =
  | { id: number; kind: "sync"; files: SourceFile[] }
  | { id: number; kind: "complete" | "hover"; path: string; pos: number };
export type LanguageReply = { id: number; value?: CodeProblem[] | CodeCompletion[] | CodeHover | null; error?: string };

export const typedFile = (path: string) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path);

/** One lazy worker per lesson. No learner code is executed or sent to a third party. */
export class LanguageService {
  private worker: Worker | undefined;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
  private request<T>(request: Omit<Extract<LanguageRequest, { kind: "sync" }>, "id"> | Omit<Extract<LanguageRequest, { path: string }>, "id">): Promise<T> {
    if (!this.worker) {
      this.worker = new Worker(new URL("./language.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = ({ data }: MessageEvent<LanguageReply>) => {
        const pending = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) pending?.reject(new Error(data.error));
        else pending?.resolve(data.value);
      };
      this.worker.onerror = () => this.fail("Language assistance could not start. Run checks for compiler errors.");
    }
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
      this.worker!.postMessage({ ...request, id });
    });
  }
  sync(files: SourceFile[]) { return this.request<CodeProblem[]>({ kind: "sync", files }); }
  complete(path: string, pos: number) { return this.request<CodeCompletion[]>({ kind: "complete", path, pos }); }
  hover(path: string, pos: number) { return this.request<CodeHover | null>({ kind: "hover", path, pos }); }
  private fail(message: string) {
    for (const p of this.pending.values()) p.reject(new Error(message));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = undefined;
  }
  dispose() { this.fail("Lesson closed."); }
}
