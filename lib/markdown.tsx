// Zero-dependency Markdown renderer for article bodies. Parses a useful subset
// to REACT ELEMENTS (never HTML strings), so there is no dangerouslySetInnerHTML
// and no XSS surface even though admins author the source. Supported: #..####
// headings, paragraphs, - / 1. lists, > quotes, ``` code fences, `code`,
// **bold**, *italic*, [links](url), ![images](url), --- rules.
//
// **来場者に見える文（展示情報・自己紹介・来歴）にも使う**（ユーザー要望 2026-08-13）。
// そこは**誰でも書ける**ので、記事（管理者だけが書く）と同じ扱いにはしない:
// `renderMarkdown(md, { images: false })` で画像を落とす。作家が任意のURLの画像を
// 埋められると、**来場者のIPが第三者のサーバへ渡る**（追跡ピクセル）── 同意も告知も
// 無しにそれが起きる形は作らない。画像は代替テキストとして文字で出る。
//
// 3Dの板に焼く文字や `<meta name="description">`、構造化データは**マークダウンを解釈
// できない場所**なので、`stripMarkdown` で記号を落とした素の文にする。
import type { ReactNode } from 'react'

/** Allow only safe URL shapes; anything else (javascript:, data:text/html…) is rejected. */
function safeUrl(raw: string): string | null {
  const u = raw.trim()
  if (/^(https?:\/\/|mailto:|\/|#)/i.test(u)) return u
  if (/^data:image\//i.test(u)) return u // inline images the admin pasted
  return null
}

type Inline = { re: RegExp; make: (m: RegExpExecArray, key: string) => ReactNode }

/** 描画の選択肢。既定は記事と同じ（画像あり）。 */
export interface MarkdownOptions {
  /** `false` で画像を描かず代替テキストだけにする。**来場者に見える、作家が書いた文**は
   *  必ずこちら（追跡ピクセルを埋められないように）。 */
  images?: boolean
  /** `true` で段落の中の**改行をそのまま改行として出す**（GFM の hard break と同じ）。
   *  記事（管理者が書く）は本来のマークダウンどおり空行で段落を切るので既定は `false`。
   *  一方、来歴のような**1行1件で書かれる欄**は素の改行が意味を持つ ── ここを `false` の
   *  ままにすると `para.join(' ')` で1段落に潰れ、「2024 個展 2023 グループ展」と続いて
   *  読めなくなる（実測して直した）。 */
  breaks?: boolean
}

// Order matters: code first (its content is literal), then images/links, then emphasis.
/** 画像。`images: false` のときはこの規則だけを外す（名前で参照するためだけに切り出す）。 */
const IMAGE_INLINE: Inline = {
  re: /^!\[([^\]]*)\]\(([^)\s]+)\)/,
  make: (m, key) => {
    const src = safeUrl(m[2])
    // eslint-disable-next-line @next/next/no-img-element
    return src ? <img key={key} src={src} alt={m[1]} className="md-inline-img" /> : <span key={key}>{m[1]}</span>
  },
}

/** `images: false` のときに `IMAGE_INLINE` と**差し替える**規則。外すだけでは
 *  `![x](https://…)` が素の文字として残り、**URLがそのまま本文に出る**（実測して直した）。
 *  代替テキストだけを出す。 */
const IMAGE_ALT_ONLY: Inline = {
  re: IMAGE_INLINE.re,
  make: (m, key) => <span key={key}>{m[1]}</span>,
}

const INLINE: Inline[] = [
  { re: /^`([^`]+)`/, make: (m, key) => <code key={key} className="md-code">{m[1]}</code> },
  IMAGE_INLINE,
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
function renderInline(text: string, keyPrefix: string, opts?: MarkdownOptions): ReactNode[] {
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
  const rules =
    opts?.images === false ? INLINE.map((p) => (p === IMAGE_INLINE ? IMAGE_ALT_ONLY : p)) : INLINE
  while (i < text.length) {
    const rest = text.slice(i)
    let hit = false
    for (const p of rules) {
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
export function renderMarkdown(md: string, opts?: MarkdownOptions): ReactNode {
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
      blocks.push(<Tag key={key++}>{renderInline(h[2], `h${key}`, opts)}</Tag>)
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
      blocks.push(<blockquote key={key++}>{renderInline(quote.join(' '), `q${key}`, opts)}</blockquote>)
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
            <li key={j}>{renderInline(it, `ul${key}-${j}`, opts)}</li>
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
            <li key={j}>{renderInline(it, `ol${key}-${j}`, opts)}</li>
          ))}
        </ol>
      )
      continue
    }

    // Standalone image → figure with caption
    const img = opts?.images === false ? null : /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line)
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
    if (opts?.breaks) {
      const k0 = key++
      blocks.push(
        <p key={k0}>
          {para.flatMap((l, j) => {
            const run = renderInline(l, `p${k0}-${j}`, opts)
            return j === 0 ? run : [<br key={`br${k0}-${j}`} />, ...run]
          })}
        </p>
      )
    } else {
      blocks.push(<p key={key++}>{renderInline(para.join(' '), `p${key}`, opts)}</p>)
    }
  }
  return blocks
}

/** マークダウンの記号を落として素の1本の文にする。**マークダウンを解釈できない場所**
 *  （3Dの板に焼く文字・`<meta name="description">`・構造化データ・OG画像）で使う。
 *  ここを通さないと、`**強調**` や `- 箇条書き` が記号ごと検索結果に出る。
 *
 *  描画（`renderMarkdown`）と同じ規則を**別に書き写している**わけではない: あちらは
 *  「要素にする」、こちらは「記号を消す」で、目的が違うぶん取りこぼしても壊れ方が軽い
 *  （記号が1つ残るだけ）。それでも書式は1か所にまとめてある。 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ') // コードブロックは丸ごと落とす
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // 見出しの #
    .replace(/^\s{0,3}>\s?/gm, '') // 引用の >
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '') // 箇条書き・番号
    .replace(/^\s{0,3}(?:\*\*\*|---|___)\s*$/gm, '') // 水平線
    .replace(/!\[([^\]]*)\]\([^)\s]*\)/g, '$1') // 画像 → 代替テキスト
    .replace(/\[([^\]]+)\]\([^)\s]*\)/g, '$1') // リンク → 文字だけ
    .replace(/(\*\*|__)([^*_]+)\1/g, '$2') // 太字
    .replace(/(\*|_)([^*_]+)\1/g, '$2') // 斜体
    .replace(/`([^`]+)`/g, '$1') // インラインコード
    .replace(/\s+/g, ' ')
    .trim()
}
