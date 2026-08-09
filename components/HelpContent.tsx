// The help / FAQ body, shared by two places so the eleven-language copy lives
// once (docs/DECISIONS 2026-08-03, option C): the public /help page renders it on
// the server for SEO, and the dashboard's HelpModal renders it client-side so an
// artist never leaves the page they are working on.
//
// It takes `t` as a prop rather than calling a hook, which is what lets it run in
// both worlds: the server page passes getServerT()'s `t`, the modal passes
// useT(). The two share one signature.
//
// The numbers that could drift — the per-slot price and the per-room cap — come
// from lib/pricing and lib/limits, never typed into a sentence (AGENTS.md 5.3;
// the same reason /legal interpolates them).
import { PRICE_SLOT, PRICE_ROOM, PRICE_VIDEO_PASS } from '@/lib/pricing'
import { MAX_WORKS_PER_ROOM, PLAN } from '@/lib/limits'

type T = (key: string, params?: Record<string, string | number>) => string

/** Section headings and the Q&A keys under each, in reading order. */
const SECTIONS: { title: string; qa: [q: string, a: string][] }[] = [
  { title: 'help.s1', qa: [['help.qWhat', 'help.aWhat'], ['help.qCost', 'help.aCost']] },
  { title: 'help.s2', qa: [['help.qStart', 'help.aStart'], ['help.qMax', 'help.aMax'], ['help.qCaption', 'help.aCaption'], ['help.qVideo', 'help.aVideo']] },
  { title: 'help.s3', qa: [['help.qShare', 'help.aShare'], ['help.qVisitor', 'help.aVisitor'], ['help.qReaction', 'help.aReaction']] },
  { title: 'help.s4', qa: [['help.qTrouble', 'help.aTrouble']] },
]

/** Per-video size cap in whole MB, from the plan (never typed into a sentence). */
const VIDEO_MAX_MB = Math.round(PLAN.videoBytes / (1024 * 1024))

/** Params for the answers that quote a live figure — keyed by answer key. */
const A_PARAMS: Record<string, Record<string, string | number>> = {
  'help.aCost': { slot: PRICE_SLOT, room: PRICE_ROOM, video: PRICE_VIDEO_PASS, max: MAX_WORKS_PER_ROOM },
  'help.aMax': { max: MAX_WORKS_PER_ROOM },
  'help.aVideo': { price: PRICE_VIDEO_PASS, max: VIDEO_MAX_MB },
}

export default function HelpContent({ t }: { t: T }) {
  return (
    <div className="help-body">
      {SECTIONS.map((section) => (
        <section className="help-section" key={section.title}>
          <h2 className="help-section-title">{t(section.title)}</h2>
          <dl className="help-qa-list">
            {section.qa.map(([q, a]) => (
              <div className="help-qa" key={q}>
                <dt className="help-q">{t(q)}</dt>
                <dd className="help-a">{t(a, A_PARAMS[a])}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section className="help-section help-contact">
        <h2 className="help-section-title">{t('help.contactTitle')}</h2>
        <p className="help-a">
          {t('help.contactBody')}{' '}
          {/* i18n-ok: メールアドレス */}
          <a href="mailto:support@xibit360.art">support@xibit360.art</a>
        </p>
      </section>
    </div>
  )
}
