import { useMemo, type ReactNode } from "react";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { language } from "./Editor.tsx";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { plainWikilinks } from "./text.ts";

function MarkdownCode({ children, className }: { children?: ReactNode; className?: string | undefined }) {
  const lang = /language-([\w+-]+)/.exec(className ?? "")?.[1];
  const text = String(children ?? "");
  const tokens = useMemo(() => {
    if (!lang || text.length > 50_000) return text;
    const extension = ({ typescript: "ts", javascript: "js", python: "py", rust: "rs", csharp: "cs", bash: "sh", shell: "sh" } as Record<string, string>)[lang] ?? lang;
    const support = language(`snippet.${extension}`);
    if (Array.isArray(support)) return text;
    const parser = "language" in support ? support.language.parser : support.parser;
    const nodes: ReactNode[] = [];
    let end = 0;
    highlightTree(parser.parse(text), classHighlighter, (from, to, classes) => {
      if (from > end) nodes.push(text.slice(end, from));
      nodes.push(<span key={from} className={classes}>{text.slice(from, to)}</span>);
      end = to;
    });
    if (end < text.length) nodes.push(text.slice(end));
    return nodes;
  }, [lang, text]);
  return <code className={className} data-language={lang}>{tokens}</code>;
}

/** Links from generated or fetched text open in a new tab and send no referrer. */
const LINKS: Components = {
  code: ({ node: _node, children, className }) => <MarkdownCode className={className}>{children}</MarkdownCode>,
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

export function Md(props: { children: string | undefined; fallback?: string; className?: string | undefined }) {
  return (
    <div className={props.className}>
      <Markdown remarkPlugins={[remarkGfm]} components={LINKS}>
        {plainWikilinks(props.children ?? props.fallback ?? "")}
      </Markdown>
    </div>
  );
}
