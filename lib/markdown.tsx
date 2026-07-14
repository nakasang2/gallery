// Zero-dependency Markdown renderer for article bodies. Parses a useful subset
// to REACT ELEMENTS (never HTML strings), so there is no dangerouslySetInnerHTML
// and no XSS surface even though admins author the source. Supported: #..####
// headings, paragraphs, - / 1. lists, > quotes, ``` code fences, `code`,
// **bold**, *italic*, [links](url), ![images](url), --- rules.
import type { ReactNode } from 'react'

/** Allow only safe URL shapes; anything else (javascript:, data:text/html…) is rejected. */
function safeUrl(raw: string): string | null {
  const u = raw.trim()
  if (/^(https?:\/\/|mailto:|\/|#)/i.test(u)) return u
  if (/^data:image\//i.test(u)) return u // inline images the admin pasted
  return null
}

type Inline = { re: RegExp; make: (m: RegExpExecArray, key: string) => ReactNode }

// Order matters: code first (its content is literal), then images/links, then emphasis.
const INLINE: Inline[] = [
  { re: /^`([^`]+)`/, make: (m, key) => <code key={key} className="md-code">{m[1]}</code> },
  {
    re: /^!\[([^\]]*)\]\(([^)\s]+)\)/,
    make: (m, key) => {
      const src = safeUrl(m[2])
      // eslint-disable-next-line @next/next/no-img-element
      return src ? <img key={key} src={src} alt={m[1]} className="md-inline-img" /> : <span key={key}>{m[1]}</span>
    },
  },
  {
    re: /^\[([^\]]+)\]\(([^)\s]+)\)/,
    make: (m, key) => {
      const href = safeUrl(m[2])
      if (!href) return <span key={key}>{renderInline(m[1], key)}</span>
      const external = /^https?:/i.test(href)
      return (
        <a key={key} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {renderInline(m[1], key)}
        </a>
      )
    },
  },
  { re: /^\*\*([^*]+)\*\*/, make: (m, key) => <strong key={key}>{renderInline(m[1], key)}</strong> },
  { re: /^__([^_]+)__/, make: (m, key) => <strong key={key}>{renderInline(m[1], key)}</strong> },
  { re: /^\*([^*]+)\*/, make: (m, key) => <em key={key}>{renderInline(m[1], key)}</em> },
  { re: /^_([^_]+)_/, make: (m, key) => <em key={key}>{renderInline(m[1], key)}</em> },
]

/** Inline formatting within a run of text → React nodes. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let buf = ''
  let i = 0
  let k = 0
  const flush = () => {
    if (buf) {
      out.push(buf)
      buf = ''
    }
  }
  while (i < text.length) {
    const rest = text.slice(i)
    let hit = false
    for (const p of INLINE) {
      const m = p.re.exec(rest)
      if (m) {
        flush()
        out.push(p.make(m, `${keyPrefix}-${k++}`))
        i += m[0].length
        hit = true
        break
      }
    }
    if (!hit) {
      buf += text[i]
      i++
    }
  }
  flush()
  return out
}

const BLOCK_START = /^(#{1,4}\s|```|>|[-*]\s|\d+\.\s)/
const RULE = /^(\*\*\*|---|___)\s*$/

/** Render a Markdown string to a list of block-level React elements. */
export function renderMarkdown(md: string): ReactNode {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    // Fenced code block
    if (/^```/.test(line)) {
      const code: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i])
        i++
      }
      i++ // closing fence
      blocks.push(
        <pre key={key++} className="md-pre">
          <code>{code.join('\n')}</code>
        </pre>
      )
      continue
    }

    // Heading — shifted down one level so the article's <h1> title stays unique
    // (body "#" becomes <h2>, "##" → <h3>, …)
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const lvl = Math.min(h[1].length + 1, 6)
      const Tag = `h${lvl}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      blocks.push(<Tag key={key++}>{renderInline(h[2], `h${key}`)}</Tag>)
      i++
      continue
    }

    // Horizontal rule
    if (RULE.test(line)) {
      blocks.push(<hr key={key++} />)
      i++
      continue
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      blocks.push(<blockquote key={key++}>{renderInline(quote.join(' '), `q${key}`)}</blockquote>)
      continue
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''))
        i++
      }
      blocks.push(
        <ul key={key++}>
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `ul${key}-${j}`)}</li>
          ))}
        </ul>
      )
      continue
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''))
        i++
      }
      blocks.push(
        <ol key={key++}>
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `ol${key}-${j}`)}</li>
          ))}
        </ol>
      )
      continue
    }

    // Standalone image → figure with caption
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line)
    if (img) {
      const src = safeUrl(img[2])
      if (src) {
        blocks.push(
          <figure key={key++} className="md-figure">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={img[1]} />
            {img[1] && <figcaption>{img[1]}</figcaption>}
          </figure>
        )
      }
      i++
      continue
    }

    // Paragraph — gather consecutive non-block lines
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i]) && !RULE.test(lines[i])) {
      para.push(lines[i])
      i++
    }
    blocks.push(<p key={key++}>{renderInline(para.join(' '), `p${key}`)}</p>)
  }
  return blocks
}
