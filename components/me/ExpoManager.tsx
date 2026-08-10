'use client'
// 合同展示の主催者画面（migration 0044、DECISIONS 2026-08-09）。
//
// 通常展示（部屋）とは別の実体なので、**ダッシュボードの第3のタブ**として独立させた
// ── 部屋の設定の中に混ぜると「どの部屋の話か」が分からなくなる。
//
// **ここは「展示一覧＋部屋を増やす」だけの軽い画面**（ユーザー指示 2026-08-10）。
// 参加者の招待・会期を選んで公開（＝決済）は、**部屋を開いた先の編集画面**
// （通常展示と同じタブバー。合同展示の部屋にだけ「参加者」タブが出る／「公開」タブの
// 中身が会期ベースに変わる）に移した。ここに残るのは「展示を作る」「部屋を足す」
// 「部屋を開く」だけ。
//
// 流れ: ①下書きを作る（無料・誰にも見えない）→ ②部屋を足す → ③部屋を開いて招待・
// 作品掛け・会期を選んで公開 → ④会期中は `/expo/{name}` が見える → ⑤終了後7日で
// URLごと消える（同じ名前で次の会期を立てられる）。
import { useCallback, useEffect, useState } from 'react'
import { useT } from '@/components/I18nProvider'
import { useGallery } from '@/lib/store'
import { listExpoRooms, type GalleryRow } from '@/lib/galleries'
import {
  EXPO_SLUG_RE,
  addExpoRoom,
  createExpo,
  deleteExpo,
  expoErrorKey,
  expoPath,
  expoPhase,
  expoPurgeAt,
  listMyExpos,
  type Expo,
} from '@/lib/expos'
import { track } from '@/lib/analytics'

/** 日付だけ（時刻は会期の話では意味がないので出さない）。 */
function useDay() {
  return (iso: string | null) => {
    if (!iso) return ''
    const d = new Date(iso)
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : ''
  }
}

export default function ExpoManager({ onOpenRoom }: { onOpenRoom?: (roomId: string) => void }) {
  const t = useT()
  const user = useGallery((s) => s.user)
  const day = useDay()
  const [expos, setExpos] = useState<Expo[] | null>(null)
  const [rooms, setRooms] = useState<Record<string, GalleryRow[]>>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  /** 新規作成のフォーム。開いているときだけ出す（一覧を主役にする）。 */
  const [creating, setCreating] = useState(false)
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')

  const reload = useCallback(async () => {
    if (!user) return
    try {
      const list = await listMyExpos(user.id)
      setExpos(list)
      // 部屋は展示ごとに引く（数が少ないので一括にしない）。
      const byExpo: Record<string, GalleryRow[]> = {}
      for (const x of list) {
        try {
          byExpo[x.id] = await listExpoRooms(x.id)
        } catch {
          byExpo[x.id] = []
        }
      }
      setRooms(byExpo)
    } catch (e) {
      // 0044 未適用なら「まだ無い」と同じ扱いにする（/me 全体を落とさない）。
      if (expoErrorKey(e) === 'missing_table') {
        setExpos([])
        return
      }
      setErr(t('expo.loadFailed'))
      setExpos([])
    }
    // `user` を deps に入れる（`[]` だとサインイン直後に一覧が出ない）。
  }, [user, t])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!user) return null

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setErr('')
    try {
      await fn()
      await reload()
    } catch (e) {
      const key = expoErrorKey(e)
      setErr(
        key === 'slug_taken'
          ? t('expo.slugTaken')
          : key === 'slug_invalid'
            ? t('expo.slugInvalid')
            : key === 'missing_table'
              ? t('expo.notReady')
              : e instanceof Error
                ? e.message
                : String(e)
      )
    } finally {
      setBusy(false)
    }
  }

  const slugOk = EXPO_SLUG_RE.test(slug.trim().toLowerCase())

  return (
    <section className="me-section">
      <h2>{t('expo.title')}</h2>
      <p className="me-note" style={{ marginTop: 0 }}>{t('expo.intro')}</p>

      {expos === null && <p className="me-note">{t('expo.loading')}</p>}

      {expos !== null && expos.length === 0 && !creating && (
        <p className="me-note">{t('expo.empty')}</p>
      )}

      {expos !== null && expos.length > 0 && (
        <ul className="expo-list">
          {expos.map((x) => {
            const phase = expoPhase(x)
            const xr = rooms[x.id] ?? []
            const purge = expoPurgeAt(x)
            // クラス名は**そのまま書く**。`expo-${phase}` のように組むと
            // `npm run check:css` から見えず、綴りを間違えても誰も気づかない
            // （CSSだけ残って効かない、を検出できなくなる）。
            return (
              <li
                key={x.id}
                className={
                  'expo-item' +
                  (phase === 'running' ? ' expo-running' : phase === 'ended' ? ' expo-ended' : '')
                }
              >
                <div className="expo-head">
                  <span className="expo-name">{x.title || x.slug}</span>
                  <span className="expo-phase">
                    {phase === 'draft'
                      ? t('expo.phaseDraft')
                      : phase === 'running'
                        ? t('expo.phaseRunning', { until: day(x.endsAt) })
                        : t('expo.phaseEnded', { on: day(x.endsAt) })}
                  </span>
                </div>

                {/* URL は下書きのうちから見せる（配る前に確かめられる）。会期が始まって
                    いなければ開いても404なので、リンクにするのは公開後だけ。 */}
                <p className="expo-url">
                  {phase === 'draft' ? (
                    <code>{expoPath(x.slug)}</code>
                  ) : (
                    <a href={expoPath(x.slug)} target="_blank" rel="noreferrer">
                      <code>{expoPath(x.slug)}</code>
                    </a>
                  )}
                </p>

                {phase === 'ended' && purge && (
                  <p className="me-note expo-warn">{t('expo.purgeNote', { on: purge.toLocaleDateString() })}</p>
                )}

                {/* 部屋。合同展示の部屋は主催者の $25 の枠を消費しない。 */}
                <p className="me-note">
                  {xr.length === 0 ? t('expo.noRooms') : t('expo.roomCount', { n: xr.length })}
                </p>
                {xr.length > 0 && (
                  <ul className="expo-rooms">
                    {xr.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          className="btn-line"
                          onClick={() => onOpenRoom?.(r.id)}
                          disabled={!onOpenRoom}
                        >
                          {r.title || r.slug}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* 壁が空のまま公開させない（来場者が空の部屋に着く）ヒントだけここに残す。
                    招待・会期を選んで公開は、部屋を開いた先（部屋編集画面の「参加者」
                    「公開」タブ）でする（ユーザー指示 2026-08-10）。 */}
                {phase === 'draft' && xr.length === 0 && (
                  <p className="me-note">{t('expo.needRoomFirst')}</p>
                )}

                <div className="hako-actions expo-actions">
                  <button
                    type="button"
                    className="btn-line"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const roomId = await addExpoRoom(user.id, x.id, {
                          // 主催者の他の部屋とぶつからない名前にする（一意制約は
                          // (owner_id, slug)）。既に部屋があれば連番で。
                          slug: `expo-${x.slug}-${xr.length + 1}`.slice(0, 40),
                          title: x.title || x.slug,
                        })
                        track('expo_room_add', { expo: x.slug })
                        // 作った部屋をすぐ開く（そこで招待・作品掛け・会期選びをする）。
                        onOpenRoom?.(roomId)
                      })
                    }
                  >
                    {t('expo.addRoom')}
                  </button>

                  {phase === 'draft' && (
                    <button
                      type="button"
                      className="btn-line danger"
                      disabled={busy}
                      onClick={() => void run(() => deleteExpo(x.id))}
                    >
                      {t('expo.discard')}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* 新規作成 */}
      {!creating && (
        <div className="hako-actions" style={{ marginTop: '0.9rem' }}>
          <button type="button" className="btn-line" onClick={() => setCreating(true)} disabled={busy}>
            {t('expo.create')}
          </button>
        </div>
      )}

      {creating && (
        <div className="expo-new">
          <label className="me-field">
            <span>{t('expo.fieldTitle')}</span>
            <input
              value={title}
              placeholder={t('expo.fieldTitlePlaceholder')}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="me-field">
            <span>{t('expo.fieldSlug')}</span>
            <input
              value={slug}
              placeholder="spring-show" /* i18n-ok: URLの見本（訳す対象ではない） */
              maxLength={40}
              onChange={(e) => setSlug(e.target.value)}
            />
          </label>
          <p className="me-note" style={{ marginTop: 0 }}>
            {t('expo.slugNote', { url: expoPath(slug.trim().toLowerCase() || 'spring-show') })}
          </p>
          <div className="hako-actions" style={{ marginTop: '0.9rem' }}>
            <button
              type="button"
              className="btn-line btn-gold"
              disabled={busy || !slugOk}
              onClick={() =>
                void run(async () => {
                  await createExpo(user.id, { slug, title })
                  track('expo_create', {})
                  setCreating(false)
                  setSlug('')
                  setTitle('')
                })
              }
            >
              {busy ? t('common.saving') : t('expo.createGo')}
            </button>
            <button type="button" className="btn-line" onClick={() => setCreating(false)} disabled={busy}>
              {t('common.cancel')}
            </button>
          </div>
          {!slugOk && slug.trim() !== '' && <p className="me-error">{t('expo.slugInvalid')}</p>}
        </div>
      )}

      {err && <p className="me-error">{err}</p>}
    </section>
  )
}
