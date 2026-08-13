'use client'
// 合同展示の主催者画面（migration 0044、DECISIONS 2026-08-09）。
//
// 通常展示（部屋）とは別の実体だが、**タブ画面ではなくモーダル**として開く
// （ユーザー指示 2026-08-10: 「合同展示」押下後の1ウインドウで一覧・新規作成・
// 部屋を開く操作を完結させる。以前は「バッジ→タブ遷移→作成ボタン→別モーダル」の
// 多段階だった）。`HelpModal`と同じ`.purchase-backdrop`+`.help-modal`の型を自前で持つ。
//
// **ここは「展示一覧＋部屋を増やす」だけの軽い画面**（ユーザー指示 2026-08-10）。
// 参加者の招待・会期を選んで公開（＝決済）は、**部屋を開いた先の編集画面**
// （通常展示と同じタブバー。合同展示の部屋にだけ「参加者」タブが出る／「公開」タブの
// 中身が会期ベースに変わる）に移した。ここに残るのは「展示を作る」「部屋を足す」
// 「部屋を開く」だけ。新規作成フォームも**同じモーダルパネルの中で一覧と切り替える**
// （入れ子のモーダルにしない）。
//
// 流れ: ①下書きを作る（無料・誰にも見えない）→ ②部屋を足す → ③部屋を開いて招待・
// 作品掛け・会期を選んで公開 → ④会期中は `/expo/{name}` が見える → ⑤終了後7日で
// URLごと消える（同じ名前で次の会期を立てられる）。
import { useCallback, useEffect, useState } from 'react'
import { useT } from '@/components/I18nProvider'
import { useGallery } from '@/lib/store'
import { listExpoRoomsWithOwners, type ExpoRoomInfo } from '@/lib/galleries'
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
import { listMyInvites, type MyInvite } from '@/lib/invites'
import { track } from '@/lib/analytics'

/** 日付だけ（時刻は会期の話では意味がないので出さない）。 */
function useDay() {
  return (iso: string | null) => {
    if (!iso) return ''
    const d = new Date(iso)
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : ''
  }
}

export default function ExpoManager({
  onOpenRoom,
  onClose,
}: {
  onOpenRoom?: (roomId: string) => void
  onClose: () => void
}) {
  const t = useT()
  const user = useGallery((s) => s.user)
  const day = useDay()
  const [expos, setExpos] = useState<Expo[] | null>(null)
  const [rooms, setRooms] = useState<Record<string, ExpoRoomInfo[]>>({})
  /** 招かれて参加している展示（自分は主催者ではない。migration 0062）。 */
  const [participating, setParticipating] = useState<MyInvite[] | null>(null)
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
      // 部屋は展示ごとに引く（数が少ないので一括にしない）。**主催者の視点**なので
      // `listExpoRoomsWithOwners`（migration 0062の`galleries_select_expo_owner`）で
      // 参加作家の部屋も見える。持ち主が分かるように名前つきで持つ ── 参加作家の
      // 自動生成の部屋は展示名をそのままタイトルに持つので、名前が無いと全部同じ
      // ラベルに見えて誰の部屋か分からない。
      const byExpo: Record<string, ExpoRoomInfo[]> = {}
      for (const x of list) {
        try {
          byExpo[x.id] = await listExpoRoomsWithOwners(x.id)
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
    try {
      const invites = await listMyInvites(user.id)
      setParticipating(invites.filter((i) => i.status === 'accepted' && i.roomId))
    } catch {
      // 0047/0062 未適用、または読み込み失敗。この節を空にするだけ（主催者一覧は生かす）。
      setParticipating([])
    }
    // `user` を deps に入れる（`[]` だとサインイン直後に一覧が出ない）。
  }, [user, t])

  useEffect(() => {
    void reload()
  }, [reload])

  // Escapeで閉じる（HelpModal/PurchaseModalと同じ作法）。作成フォームを開いている
  // ときは、まずフォームだけ閉じる（モーダルそのものは残す）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (creating) setCreating(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [creating, onClose])

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
    <div className="purchase-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="help-modal expo-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('expo.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="purchase-close" aria-label={t('common.close')} disabled={busy} onClick={onClose}>×</button>
        <h1 className="help-modal-title">{t('expo.title')}</h1>
        <p className="me-note" style={{ marginTop: 0 }}>{t('expo.intro')}</p>

      {!creating && expos === null && <p className="me-note">{t('expo.loading')}</p>}

      {!creating && expos !== null && expos.length === 0 && (
        <p className="me-note">{t('expo.empty')}</p>
      )}

      {!creating && expos !== null && expos.length > 0 && (
        <ul className="expo-list">
          {expos.map((x) => {
            const phase = expoPhase(x)
            const xr = rooms[x.id] ?? []
            const myOwnRoom = xr.find((info) => info.room.owner_id === user.id)
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
                      : phase === 'scheduled'
                        ? t('expo.phaseScheduled', { on: day(x.startsAt) })
                        : phase === 'running'
                          ? t('expo.phaseRunning', { until: day(x.endsAt) })
                          : t('expo.phaseEnded', { on: day(x.endsAt) })}
                  </span>
                </div>

                {/* URL は下書きのうちから見せる（配る前に確かめられる）。会期が始まって
                    いなければ開いても404なので、リンクにするのは公開後（running/ended）
                    だけ ── scheduled はまだ始まっていない（0051）。 */}
                <p className="expo-url">
                  {phase === 'draft' || phase === 'scheduled' ? (
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
                    {/* 1展示・1作家1部屋（migration 0062）なので、複数の部屋があるのは
                        参加作家がそれぞれ自分の部屋を持っている状態 ── 誰の部屋か
                        分からないと開く前に選べないので、名前を添える。 */}
                    {xr.map(({ room: r, ownerName }) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          className="btn-line"
                          onClick={() => onOpenRoom?.(r.id)}
                          disabled={!onOpenRoom}
                        >
                          {r.title || r.slug}
                          {r.owner_id !== user.id && ownerName ? ` — ${ownerName}` : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* 壁が空のまま公開させない（来場者が空の部屋に着く）ヒントだけここに残す。
                    招待・会期を選んで公開は、部屋を開いた先（部屋編集画面の「参加者」
                    「公開」タブ）でする（ユーザー指示 2026-08-10）。**主催者自身の部屋**が
                    あるかどうかで判定する ── 参加作家の部屋しか無くても、主催者はまだ
                    部屋を用意していない。 */}
                {phase === 'draft' && !myOwnRoom && (
                  <p className="me-note">{t('expo.needRoomFirst')}</p>
                )}

                <div className="hako-actions expo-actions">
                  {/* 1展示・1作家1部屋（migration 0062・ユーザー決定 2026-08-13。0061の
                      「1展示1部屋」を訂正）。「もう1室」を作る導線は無い ── 合同展示の
                      部屋を複数持てると、切り替えたときに前の部屋の設定が残っているように
                      見えて混乱すると指摘され撤回した。**主催者自身の部屋**が既にあるときは
                      このボタンごと隠す（DB側の`enforce_room_allowance`/`switch_room_expo`も
                      2本目を拒否する）。参加作家の部屋は承諾した瞬間に自動で作られるので、
                      ここから作る対象ではない。 */}
                  {!myOwnRoom && (
                    <button
                      type="button"
                      className="btn-line"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const roomId = await addExpoRoom(user.id, x.id, {
                            slug: `expo-${x.slug}-1`.slice(0, 40),
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
                  )}

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

      {/* 招かれて参加している展示（自分は主催者ではない。migration 0062）。承諾した
          瞬間に自動でできた自分の部屋を、同じ「部屋を開く」入口で開ける ──
          主催者一覧と統一した形にする（ユーザー指示 2026-08-13）。 */}
      {!creating && participating !== null && participating.length > 0 && (
        <>
          <p className="invite-inbox-title">{t('expo.participatingTitle')}</p>
          <ul className="expo-list">
            {participating.map((inv) => (
              <li key={inv.id} className="expo-item">
                <div className="expo-head">
                  <span className="expo-name">{inv.expo.title || inv.expo.slug}</span>
                </div>
                {inv.expo.organizer && (
                  <p className="me-note">
                    {t('expo.participatingOrganizer', {
                      name: inv.expo.organizer.displayName || `@${inv.expo.organizer.username ?? ''}`,
                    })}
                  </p>
                )}
                <div className="hako-actions expo-actions">
                  <button
                    type="button"
                    className="btn-line"
                    onClick={() => onOpenRoom?.(inv.roomId!)}
                    disabled={!onOpenRoom}
                  >
                    {t('invite.openRoom')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {!creating && (
        <div className="hako-actions" style={{ marginTop: '0.9rem' }}>
          <button type="button" className="btn-line" onClick={() => setCreating(true)} disabled={busy}>
            {t('expo.create')}
          </button>
        </div>
      )}

      {/* 新規作成フォーム。**同じモーダルパネルの中で一覧と切り替える**（入れ子の
          モーダルにしない ── ユーザー指示 2026-08-10「全て合同展示押下後のウインドウで
          完結させたい」）。タイトルとURLを決めて作成を押すと、**展示だけでなくその
          最初の部屋も自動でできる**（以前は展示を作った後に別途「部屋を追加」を
          押す2手間だった）。 */}
      {creating && (
        <>
          <label className="me-field">
            <span>{t('expo.fieldTitle')}</span>
            <input
              value={title}
              placeholder={t('expo.fieldTitlePlaceholder')}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
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
                  const x = await createExpo(user.id, { slug, title })
                  track('expo_create', {})
                  // 最初の部屋も同時に作る（ユーザー指示 2026-08-10）。名前は展示の
                  // slugから機械的に決める ── 主催者の他の部屋とぶつからない名前は
                  // 「部屋を追加」ボタンと同じ作法。
                  const roomId = await addExpoRoom(user.id, x.id, {
                    slug: `expo-${x.slug}-1`.slice(0, 40),
                    title: x.title || x.slug,
                  })
                  track('expo_room_add', { expo: x.slug })
                  setCreating(false)
                  setSlug('')
                  setTitle('')
                  // 作った部屋をすぐ開く（そこで招待・作品掛け・会期選びをする）。
                  onOpenRoom?.(roomId)
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
        </>
      )}

      {err && <p className="me-error">{err}</p>}
      </div>
    </div>
  )
}
