import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Renders an assistant chat reply as Markdown — bold, headings, lists,
 * inline code, fenced code, links, and GFM tables (Anthropic's Sonnet
 * uses all of them when answering grounded questions).
 *
 * We pass component overrides instead of using @tailwindcss/typography
 * so the styling matches the dashboard's theme exactly (mono font for
 * code, primary green for links, muted-background for code blocks)
 * without pulling in the full prose plugin and its weight.
 *
 * `linkTarget="_blank"` and `rel="noreferrer"` are NOT applied —
 * Anthropic's outputs reference internal pages most of the time, and a
 * blanket _blank breaks navigation expectations. Add per-call if needed.
 */
export function MarkdownMessage({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={cn("text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Block elements — give them sensible vertical rhythm. Default
          // ReactMarkdown wraps top-level text in <p>, so collapse the
          // first/last paragraph margins to keep the bubble tight.
          p: ({ children }) => (
            <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>
          ),
          h1: ({ children }) => (
            <h1 className="mb-1.5 mt-3 text-base font-semibold first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1 mt-2 text-sm font-medium first:mt-0">
              {children}
            </h3>
          ),
          ul: ({ children }) => (
            <ul className="my-1.5 list-disc space-y-0.5 pl-5 first:mt-0 last:mb-0">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 list-decimal space-y-0.5 pl-5 first:mt-0 last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          // Inline emphasis.
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          // Inline + block code use the theme's mono token. Block code
          // gets a muted background panel so it stands apart from prose.
          code: ({ className: cls, children, ...props }) => {
            const isBlock = (cls ?? "").includes("language-");
            if (isBlock) {
              return (
                <code
                  className={cn(
                    "block overflow-x-auto rounded-md bg-muted px-2.5 py-2 font-mono text-xs",
                    cls
                  )}
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2 first:mt-0 last:mb-0">{children}</pre>
          ),
          // GFM tables — borders match the dashboard's table primitive.
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
              <table className="w-full border-collapse border border-border text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted/50">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border border-border px-2 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1 align-top">
              {children}
            </td>
          ),
          // Blockquote + horizontal rule for completeness.
          blockquote: ({ children }) => (
            <blockquote className="my-1.5 border-l-2 border-border pl-3 text-muted-foreground first:mt-0 last:mb-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-2 border-border" />,
          // Links — primary green, underlined on hover. Keep target=_self
          // (reasoning above).
          a: ({ children, href }) => (
            <a
              href={href}
              className="text-primary underline-offset-2 hover:underline"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
