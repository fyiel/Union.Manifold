import type { ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Link } from "react-router-dom"

const USER_MENTION_RE = /(^|[^\w/])@([A-Za-z0-9_.-]{2,32})(?=$|[^\w.-])/g

function linkifyUserMentions(text: string): string {
  return String(text || "").replace(USER_MENTION_RE, (match, prefix, username) => {
    if (!username) return match
    return `${prefix}[@${username}](/user/${encodeURIComponent(username)})`
  })
}

const markdownComponents = {
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="mt-4 mb-2 text-xl font-black leading-tight first:mt-0 sm:text-2xl">{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="mt-4 mb-2 text-lg font-bold leading-tight first:mt-0 sm:text-xl">{children}</h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="mt-3 mb-1.5 text-base font-bold leading-tight sm:text-lg">{children}</h3>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="my-1.5 leading-relaxed [overflow-wrap:anywhere]">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="my-2 ml-5 list-disc space-y-1 marker:text-primary">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="my-2 ml-5 list-decimal space-y-1 marker:text-primary">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="my-3 rounded-r-lg border-l-2 border-white/10 bg-white/[0.03] px-3 py-2 text-inherit/80">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-white/10" />,
  code: ({ children }: { children?: ReactNode }) => (
    <code className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 font-mono text-[0.8rem] text-primary/90">
      {children}
    </code>
  ),
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="my-3 overflow-x-auto rounded-xl border border-white/10 bg-black/30 p-3 text-[0.85rem] text-zinc-100">
      {children}
    </pre>
  ),
  strong: ({ children }: { children?: ReactNode }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }: { children?: ReactNode }) => <em className="italic">{children}</em>,
  a: ({ href, children }: { href?: string; children?: ReactNode }) => {
    if (typeof href === "string" && href.startsWith("/")) {
      return (
        <Link to={href} className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80">
          {children}
        </Link>
      )
    }

    const isExternal = typeof href === "string" && /^https?:\/\//.test(href)
    return (
      <a
        href={href}
        className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
      >
        {children}
      </a>
    )
  },
}

export function CommentMarkdown({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`w-full min-w-0 max-w-full text-sm leading-relaxed [overflow-wrap:anywhere] ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {linkifyUserMentions(text)}
      </ReactMarkdown>
    </div>
  )
}