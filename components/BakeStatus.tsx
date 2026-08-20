'use client'
// 「光の焼き込み」の状態と、焼き直しの導線。
//
// **判定と実行はこのファイルの `useBakeFreshness` だけが持つ**（2026-08-19）。見せ方は2つ
// ある ── 公開ステージの1行（`BakeStatus`）と、部屋の見出しの保存ボタン（保存が済んで
// 古くなっていると「表示を更新する」に切り替わる。ユーザー案 2026-08-19）。**同じ判断を
// 2か所に写して書かない**ため、フックを部屋の高さで1回呼び、結果を両方へ渡す
// （【絶対ルール】2026-08-12）。焼く実体（`runner`）も部屋の高さに置く ── 公開タブから
// 離れても焼き込みが止まらないようにするため。
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
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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

export type BakePhase = 'unknown' | 'fresh' | 'stale' | 'baking' | 'saved' | 'skipped' | 'failed'

/** 焼き込みの状態と入口。パネルと保存ボタンの両方が同じこれを受け取る。 */
export type BakeControls = { phase: BakePhase; progress: BakeProgress; start: () => void }

/**
 * 焼き込みの状態を1つだけ持ち、焼く実体をぶら下げる。**部屋の高さで1回だけ呼ぶ。**
 *
 * 返す `runner` は必ずどこかに描くこと ── これが焼き込みの本体で、公開タブの外に置いて
 * あるからタブを移っても止まらない（ただしタブを**ブラウザごと**裏に回すと描画が止まる
 * ので、それは文言で伝えている）。
 */
export function useBakeFreshness({
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
}): BakeControls & { runner: ReactNode } {
  const [phase, setPhase] = useState<BakePhase>('unknown')
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

  /** 焼いている最中に保存が終わったか。**焼き込みは「始めた時点の中身」を焼く**
   *  （`start` が `check` で取ってきた `PublicExhibition` を `ShadowBakeRunner` に渡し、
   *  そこから動かない）ので、その最中に保存された変更はそのまま**古い控え**になる。
   *  焼き終わってから見直すために、印だけ残しておく。 */
  const savedWhileBaking = useRef(false)

  // 保存が終わった瞬間（busy: true → false）に見直す。これが無いと、公開中の部屋を
  // 触っても「古くなっています」がタブを開き直すまで出てこない。
  const wasBusy = useRef(busy)
  useEffect(() => {
    const settled = wasBusy.current && !busy
    wasBusy.current = busy
    if (!settled || !isPublic) return
    // **焼いている最中はその場で見直せない** ── `check` が `phase` を `fresh`/`stale` へ
    // 上書きしてしまい、進捗の表示も二重起動の抑止（ボタンの `disabled`）も消える。
    // 保存ボタンは**未保存を焼き込みの進捗より優先する**設計（`SaveAllButton`。別視点
    // レビュー 2026-08-19）なので、**焼いている最中の保存は実際に起こせる**。
    // 印を立てて `onFinished` で見直す（2026-08-20・別視点レビュー）。
    if (phase === 'baking') savedWhileBaking.current = true
    else void check()
  }, [busy, isPublic, phase, check])

  /** 焼き終わった時点の `check`。**`onFinished` の同一性を変えないため** ref 越しに読む
   *  ── `onFinished` は `ShadowBakeRunner` へ渡す prop で、差し替わると向こうの
   *  `useCallback`（`allBaked`）が作り直される。 */
  const checkRef = useRef(check)
  useEffect(() => {
    checkRef.current = check
  }, [check])

  const start = useCallback(() => {
    void (async () => {
      const r = await check()
      if (!r) return
      setProgress({ done: 0, total: r.total })
      setTarget(r.ex)
      setPhase('baking')
    })()
  }, [check])

  const onFinished = useCallback((r: SaveShadowBakeResult) => {
    setTarget(null)
    const staleWhileBaking = savedWhileBaking.current
    savedWhileBaking.current = false
    if (!r.ok) {
      // 失敗・容量不足はそのまま出す。**ここで見直さない** ── `failed` は保存ボタンを
      // 赤く出す（`showBake` に入っている）ので押し直す入口は既にあり、`stale` で
      // 上書きするとパネルの「失敗しました」だけが消える。
      setPhase(r.skipped ? 'skipped' : 'failed')
      return
    }
    setPhase('saved')
    // **焼いている最中に保存が終わっていたら、焼けたのは1つ前の中身。** 見直して
    // 「古くなっています」を出し直す ── これが無いと、控えは来場者側の指紋照合で
    // 捨てられる（＝影の無い展示に戻る）のに、作家のボタンは灰色の「保存」に戻って
    // しまい、押し直す入口がタブを開き直すまで無い。
    if (staleWhileBaking) void checkRef.current()
  }, [])

  return {
    phase,
    progress,
    start,
    runner: target ? (
      <ShadowBakeRunner exhibition={target} onProgress={setProgress} onFinished={onFinished} />
    ) : null,
  }
}

/**
 * 公開ステージに出す1行。**いまは失敗したときだけ出す**（ユーザー指摘 2026-08-19
 * 「公開タブのこの部分は一切不要です」）。
 *
 * 「古くなっています → 表示を更新する」「更新中… n / 総数」「最新です」は**保存ボタンが
 * 全部引き受けた**ので、ここに置くと同じことを2か所で言うことになる。
 * **失敗と容量不足だけは残す** ── ボタンは「押していない用事」しか出さないので、
 * 失敗したことと、その理由（容量が足りない）を伝える面が他に無い。ここを消すと
 * 黙って失敗する。次に部屋を開けば判定が走り直してボタンが再び赤くなるので、
 * 押し直す入口はここと合わせて2つある。
 */
export default function BakeStatus({
  phase,
  onStart,
}: {
  phase: BakePhase
  onStart: () => void
}) {
  const t = useT()
  if (phase !== 'failed' && phase !== 'skipped') return null

  return (
    <div className="bake-status">
      {phase === 'skipped' ? (
        <p className="bake-line">{t('me.bakeSkipped')}</p>
      ) : (
        <>
          <p className="bake-line">{t('me.bakeFailed')}</p>
          <button type="button" className="bake-btn" onClick={onStart}>
            {t('me.bakeUpdate')}
          </button>
        </>
      )}
    </div>
  )
}
