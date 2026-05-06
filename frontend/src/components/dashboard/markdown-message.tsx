import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Markdown renderer for assistant replies. Custom component overrides
 * (instead of @tailwindcss/typography) so styling tracks the dashboard
 * theme without the prose plugin's weight.
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
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
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
          blockquote: ({ children }) => (
            <blockquote className="my-1.5 border-l-2 border-border pl-3 text-muted-foreground first:mt-0 last:mb-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-2 border-border" />,
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
