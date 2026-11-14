import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { plainWikilinks } from "./text.ts";

/** Links from generated or fetched text open in a new tab and send no referrer. */
const LINKS: Components = {
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
