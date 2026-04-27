import ReactMarkdown from "react-markdown";

export function LegalDocument({ content }: { content: string }) {
  return (
    <article className="prose max-w-none space-y-4 text-ink">
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1 className="text-3xl font-semibold text-ink">{children}</h1>,
          h2: ({ children }) => <h2 className="pt-4 text-xl font-semibold text-ink">{children}</h2>,
          h3: ({ children }) => <h3 className="pt-2 text-lg font-semibold text-ink">{children}</h3>,
          p: ({ children }) => <p className="leading-7 text-ink/75">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-2 pl-6 text-ink/75">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-2 pl-6 text-ink/75">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          a: ({ children, href }) => (
            <a href={href} className="text-accent underline underline-offset-2">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-ink/15 pl-4 text-ink/65">{children}</blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded bg-ink/[0.04] px-1.5 py-0.5 text-sm text-ink">{children}</code>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}

