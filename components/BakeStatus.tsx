'use client'
// 「光の焼き込み」の状態と、焼き直しの導線。公開ステージに1行で置く。
//
// なぜ前面で待たせるのか（ユーザー指摘 2026-08-18・DECISIONS 同日）:
// **裏で黙って進めると作家は待つ理由が分からず離脱する。画像アップロード中に離脱する
// 人はいないので、同じ「進捗が出ているから待つ」体験に揃える。** 待つあいだタブが前面に
// あることには実利もある ── 裏に回すとブラウザが描画を止め、1フレーム1作品の焼き込みが
// そこで停まる。
//
// 焼き直しは**手動ボタンだけ**（ユーザー決定 2026-08-18）。公開トグルをONにした瞬間だけは
// 自動で走る ── そこが「出展した」という唯一の自然な区切りだから。
//
// **公開トグルは絶対にOFFにしない。** 焼き込みは作品ではなくキャッシュで、古い控えは
// 来場者側が指紋で必ず捨てる（＝間違った影は出ない。結果は「焼き込みが無い状態」に
// 戻るだけ）。自動でOFFにすると、額を一つ変えただけで展示が閉まり、作家が気づかない
// うちに公開URLが404になる。
import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useT } from '@/components/I18nProvider'
import { fetchPublicExhibition, type PublicExhibition } from '@/lib/publish'
import { visitorSettings, buildPlacement } from '@/lib/exhibition'
import { resolveLayout } from '@/lib/presets'
import { buildBakePlan } from '@/components/gallery/bakePlan'
import { bakeMatches } from '@/lib/shadowBake'
import type { SaveShadowBakeResult } from '@/lib/shadowBakeClient'
import type { BakeProgress } from '@/components/gallery/ShadowBakeRunner'

// three とシーン一式は、焼くと決めた瞬間まで読み込まない（ダッシュボードを重くしない）
const ShadowBakeRunner = dynamic(() => import('@/components/gallery/ShadowBakeRunner'), { ssr: false })

type Phase = 'unknown' | 'fresh' | 'stale' | 'baking' | 'saved' | 'skipped' | 'failed'

export default function BakeStatus({
  slug,
  username,
  isPublic,
  busy,
}: {
  slug: string
  username: string | null
  isPublic: boolean
  /** ダッシュボードの保存中フラグ。**true → false の瞬間に見直す** ── 作家が公開中の
   *  部屋を触ったあと「古くなっています」がすぐ出るために要る。下書きの変化そのものを
   *  見張ると打鍵ごとに問い合わせてしまうので、**保存が終わった合図**に乗る。 */
  busy: boolean
}) {
  const t = useT()
  const [phase, setPhase] = useState<Phase>('unknown')
  const [progress, setProgress] = useState<BakeProgress>({ done: 0, total: 0 })
  const [target, setTarget] = useState<PublicExhibition | null>(null)
  /** 公開トグルが false → true に変わった瞬間だけ自動で焼く。初回マウントでは焼かない
   *  （すでに公開されている部屋を開くたびに焼き直すのは、作家が頼んでいない作業）。 */
  const wasPublic = useRef(isPublic)

  /** 公開されている中身を読み、保存済みの控えが今の構成のものかを見る。
   *  **判定は来場者と同じ材料で行う** ── 下書きから作ると、来場者が見ている部屋とは
   *  別のものについて「最新です」と言うことになる。 */
  const check = useCallback(async (): Promise<{ ex: PublicExhibition; total: number } | null> => {
    if (!username || !isPublic) return null
    const ex = await fetchPublicExhibition(username, slug)
    if (!ex) return null
    const settings = visitorSettings(ex)
    const { list, slots } = buildPlacement(settings, ex.artworks)
    const plan = buildBakePlan(settings, list, slots, resolveLayout(settings.layout, settings.layoutParams))
    setPhase(plan.specs.length === 0 || bakeMatches(ex.shadowBake, plan.key, plan.ids) ? 'fresh' : 'stale')
    return { ex, total: plan.specs.length }
  }, [username, slug, isPublic])

  useEffect(() => {
    let alive = true
    const justPublished = isPublic && !wasPublic.current
    wasPublic.current = isPublic
    if (!isPublic) {
      setPhase('unknown')
      setTarget(null)
      return
    }
    void check().then((r) => {
      if (!alive || !r) return
      // 公開した直後だけは、そのまま焼きに入る（作家に押させない）
      if (justPublished) {
        // **総数は焼く前から分かっている**ので先に入れる。0 のままにすると、3Dの読み込みが
        // 終わるまで「0 / 0」と出て、進んでいないように見える。
        setProgress({ done: 0, total: r.total })
        setTarget(r.ex)
        setPhase('baking')
      }
    })
    return () => {
      alive = false
    }
  }, [isPublic, check])

  // 保存が終わった瞬間（busy: true → false）に見直す。これが無いと、公開中の部屋を
  // 触っても「古くなっています」がタブを開き直すまで出てこない。
  const wasBusy = useRef(busy)
  useEffect(() => {
    const settled = wasBusy.current && !busy
    wasBusy.current = busy
    if (settled && isPublic && phase !== 'baking') void check()
  }, [busy, isPublic, phase, check])

  const startBake = async () => {
    const r = await check()
    if (!r) return
    setProgress({ done: 0, total: r.total })
    setTarget(r.ex)
    setPhase('baking')
  }

  const onFinished = (r: SaveShadowBakeResult) => {
    setTarget(null)
    if (r.ok) setPhase('saved')
    else setPhase(r.skipped ? 'skipped' : 'failed')
  }

  if (!isPublic || phase === 'unknown') return null

  return (
    <div className="bake-status">
      {phase === 'baking' ? (
        <>
          <p className="bake-line" role="status" aria-live="polite">
            {t('me.bakeRunning', { done: progress.done, total: progress.total })}
          </p>
          <p className="bake-note">{t('me.bakeWait')}</p>
        </>
      ) : phase === 'stale' ? (
        <>
          <p className="bake-line">{t('me.bakeStale')}</p>
          <button type="button" className="bake-btn" onClick={() => void startBake()}>
            {t('me.bakeUpdate')}
          </button>
          <p className="bake-note">{t('me.bakeStaleNote')}</p>
        </>
      ) : phase === 'skipped' ? (
        <p className="bake-line">{t('me.bakeSkipped')}</p>
      ) : phase === 'failed' ? (
        <>
          <p className="bake-line">{t('me.bakeFailed')}</p>
          <button type="button" className="bake-btn" onClick={() => void startBake()}>
            {t('me.bakeUpdate')}
          </button>
        </>
      ) : (
        <p className="bake-note">{t('me.bakeFresh')}</p>
      )}

      {target && (
        <ShadowBakeRunner exhibition={target} onProgress={setProgress} onFinished={onFinished} />
      )}
    </div>
  )
}
