/** Obsidian-style wikilinks read as their label or note name. */
export function plainWikilinks(text: string): string {
  return text.replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_, path: string, label?: string) => label ?? path.split("/").pop()!.replace(/\.md$/, ""));
}

/** Drop a leading "# Title" that a caller already shows as a heading. */
export function dropTitle(md: string): string {
  return md.replace(/^\s*# [^\n]*\n+/, "");
}

/** Fill {{name}} placeholders; unknown names become empty. */
export function fill(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => vars[k] ?? "").replace(/\n{3,}/g, "\n\n").trim();
}
