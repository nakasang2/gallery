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
import { PRICE_SLOT, PRICE_ROOM, PRICE_VIDEO_PASS, expoPriceRangeLabel } from '@/lib/pricing'
import { MAX_WORKS_PER_ROOM, PLAN } from '@/lib/limits'

type T = (key: string, params?: Record<string, string | number>) => string

/**
 * Section headings and the Q&A keys under each, in reading order.
 *
 * **機能ごとの章立てにしてある**（ユーザー決定 2026-08-12・B案）。以前は
 * 「はじめに／部屋をつくる／公開・共有／困ったとき」の4章10問で、**入口の質問しか
 * 無く、出荷済み16機能のうち10個が一言も出てこなかった**（招待・トリミング位置・
 * 購入リンク・額縁・テーマ・間取り・BGM・音声ガイド・カタログ・埋め込み・録画）。
 * 作家が「これはどこで設定するのか」を探せる索引になっていなかった。
 *
 * 章は**作業の単位**に合わせる ── ダッシュボードのタブ（作品／部屋／公開）と同じ
 * 並びにしてあるので、読んだあとどこを触ればいいかが対応する。
 */
const SECTIONS: { title: string; qa: [q: string, a: string][] }[] = [
  { title: 'help.s1', qa: [['help.qWhat', 'help.aWhat'], ['help.qCost', 'help.aCost'], ['help.qStart', 'help.aStart']] },
  // お金と権利（2026-08-15 追加）。**購入・登録を止めるのはこの3問**なのに、19問の
  // どこにも答えが無かった（LPの構成レビューで判明）── 返金の条件は規約と特商法に、
  // 権利とAI学習は規約とプライバシーにしか書いておらず、**読む人が最も少ない面にだけ
  // 置かれていた**。LPの料金セクションからここへ導線を張ってある。
  // キーが `s7` なのは後から足したからで、**読む順はこの配列の順**（章の並びは
  // 「作業の単位」だが、この章だけは作業ではなく判断の材料なので料金の直後に置く）。
  { title: 'help.s7', qa: [
    ['help.qRefund', 'help.aRefund'],
    ['help.qRights', 'help.aRights'],
    ['help.qAi', 'help.aAi'],
  ] },
  // 作品タブでできること
  { title: 'help.s2', qa: [
    ['help.qMax', 'help.aMax'],
    ['help.qStorage', 'help.aStorage'],
    ['help.qCaption', 'help.aCaption'],
    ['help.qCrop', 'help.aCrop'],
    ['help.qVideo', 'help.aVideo'],
    ['help.qGuide', 'help.aGuide'],
    ['help.qBuy', 'help.aBuy'],
  ] },
  // 部屋タブ・配置タブでできること
  { title: 'help.s3', qa: [['help.qLook', 'help.aLook'], ['help.qPlace', 'help.aPlace'], ['help.qBgm', 'help.aBgm']] },
  // 公開タブでできること
  { title: 'help.s4', qa: [
    ['help.qShare', 'help.aShare'],
    ['help.qVisitor', 'help.aVisitor'],
    ['help.qReaction', 'help.aReaction'],
    ['help.qElsewhere', 'help.aElsewhere'],
  ] },
  // 部屋を増やす・複数の作家で開く
  { title: 'help.s5', qa: [['help.qRooms', 'help.aRooms'], ['help.qJoint', 'help.aJoint']] },
  { title: 'help.s6', qa: [['help.qTrouble', 'help.aTrouble']] },
]

/** Per-video size cap in whole MB, from the plan (never typed into a sentence). */
const VIDEO_MAX_MB = Math.round(PLAN.videoBytes / (1024 * 1024))
/** 口座あたりの保存容量。同じ理由で文に書かず PLAN から出す。 */
const STORAGE_MAX_MB = Math.round(PLAN.storageBytes / (1024 * 1024))

/** Params for the answers that quote a live figure — keyed by answer key. */
const A_PARAMS: Record<string, Record<string, string | number>> = {
  'help.aCost': { slot: PRICE_SLOT, room: PRICE_ROOM, video: PRICE_VIDEO_PASS, max: MAX_WORKS_PER_ROOM },
  'help.aMax': { max: MAX_WORKS_PER_ROOM },
  'help.aVideo': { price: PRICE_VIDEO_PASS, max: VIDEO_MAX_MB },
  'help.aStorage': { storage: STORAGE_MAX_MB, video: VIDEO_MAX_MB },
}

export default function HelpContent({ t }: { t: T }) {
  // 合同展示の場所代は会期ごとに違うので、幅を価格表から導出する（数字を文に書かない）
  const params: Record<string, Record<string, string | number>> = {
    ...A_PARAMS,
    'help.aRooms': { room: PRICE_ROOM, max: MAX_WORKS_PER_ROOM },
    'help.aJoint': { price: expoPriceRangeLabel(t('lp.priceRange')) },
  }
  return (
    <div className="help-body">
      {SECTIONS.map((section) => (
        <section className="help-section" key={section.title}>
          <h2 className="help-section-title">{t(section.title)}</h2>
          <dl className="help-qa-list">
            {section.qa.map(([q, a]) => (
              <div className="help-qa" key={q}>
                <dt className="help-q">{t(q)}</dt>
                <dd className="help-a">{t(a, params[a])}</dd>
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
