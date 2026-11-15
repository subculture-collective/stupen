import { typescriptService } from "./typescriptService.ts";
import type { LanguageReply, LanguageRequest } from "./languageService.ts";

const definitions = import.meta.glob("../../node_modules/typescript-language-service/lib/lib.*.d.ts", { eager: true, query: "?raw", import: "default", exhaustive: true });
const libs = Object.fromEntries(Object.entries(definitions).map(([path, text]) => [`/lib/${path.split("/").at(-1)}`, text as string]));
const nodeTypes = import.meta.glob("../../node_modules/@types/node/**/*.d.ts", { eager: true, query: "?raw", import: "default", exhaustive: true });
for (const [path, text] of Object.entries(nodeTypes)) libs[`/node_modules/@types/node/${path.split("/@types/node/")[1]}`] = text as string;
const service = typescriptService(libs);
self.onmessage = ({ data }: MessageEvent<LanguageRequest>) => {
  try {
    const value = data.kind === "sync" ? service.sync(data.files) : service[data.kind](data.path, data.pos);
    self.postMessage({ id: data.id, value } satisfies LanguageReply);
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) } satisfies LanguageReply);
  }
};
