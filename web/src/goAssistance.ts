import type { CodeCompletion } from "./languageService.ts";
import goDocs from "./goDocs.json" with { type: "json" };

type Entry = { signature: string; documentation: string; type: string };
type Catalog = Record<string, Record<string, Entry>>;
const docs: Catalog = goDocs;

export function importedPackage(qualifier: string, code: string): string | undefined {
  for (const declaration of code.matchAll(/\bimport\s*(?:\(([\s\S]*?)\)|((?:\w+\s+)?"[^"\n]+"))/g)) {
    for (const match of (declaration[1] ?? declaration[2] ?? "").matchAll(/(?:^|\n)\s*(?:(\w+|[._])\s+)?"([^"\n]+)"/g)) {
      if ((match[1] ?? match[2]!.split("/").at(-1)) === qualifier) return match[2];
    }
  }
  return undefined;
}

export async function goCompletions(code: string, qualifier?: string): Promise<CodeCompletion[]> {
  const entries = qualifier ? docs[importedPackage(qualifier, code) ?? ""] : docs.builtin;
  return Object.entries(entries ?? {}).filter(([name]) => !name.includes(".")).map(([name, entry]) => ({ label: name, type: entry.type, detail: entry.signature, info: entry.documentation }));
}

export async function goDocumentation(word: string, qualifier: string | undefined, code: string): Promise<Entry | null> {
  return (qualifier ? docs[importedPackage(qualifier, code) ?? ""]?.[word] : docs.builtin?.[word]) ?? null;
}
