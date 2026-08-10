'use client'
// 合同展示の招待（migration 0047。0041 の部屋単位から**展示単位**へ載せ替えた）。
// 2つの面を1ファイルに置く:
//
//   InviteInbox      — **作家側**。/me の一番上。招待は通知にも出るが、**通知は流れて
//                      いく**ので「いま自分が参加している展示」を置く場所が要る。
//   ParticipantsPanel — **主催者側**。合同展示タブ（`ExpoManager`）の各展示の中身。
//
// 同じ file にしたのは、両者が同じ状態機械（pending → accepted/declined → 提出）の
// 別の端であり、片方だけ直すと必ず食い違うため。
import { useCallback, useEffect, useState } from 'react'
import { useT } from '@/components/I18nProvider'
import { useGallery } from '@/lib/store'
import { artworkSrcSet } from '@/lib/cloud'
import {
  inviteArtistToExpo,
  inviteErrorKey,
  listExpoInvites,
  listMyInvites,
  respondToInvite,
  revokeInvite,
  setMySubmissions,
  type ExpoInvite,
  type MyInvite,
} from '@/lib/invites'
import { track } from '@/lib/analytics'

/* ============================ 作家側: 受信箱 ============================ */

export function InviteInbox() {
  const t = useT()
  const user = useGallery((s) => s.user)
  const cloudArtworks = useGallery((s) => s.cloudArtworks)
  const [invites, setInvites] = useState<MyInvite[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  /** どの招待の作品選びを開いているか。閉じているのが既定（受信箱が長くなるため）。 */
  const [openId, setOpenId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!user) return
    try {
      setInvites(await listMyInvites(user.id))
    } catch (e) {
      // 0047 未適用のDBでは表が無い。受信箱は「無い」と同じ扱いにする（/me 全体を
      // 落とさない — 招待は主機能ではない）。
      console.error('could not load invites (is migration 0047 applied?):', e)
      setInvites([])
    }
    // `user` を deps に入れる。`[]` だと**サインイン直後に受信箱が出ない** —
    // 下の useEffect は `user` の変化で走るが、`reload` は最初のレンダの
    // クロージャ（`user` は null）を掴んだままなので `if (!user) return` で
    // 早期 return し、二度と読み込まない。
  }, [user])

  useEffect(() => {
    if (user) void reload()
  }, [user, reload])

  if (!invites || invites.length === 0) return null

  // 保留中を先に、次に受諾済み。辞退したものは畳んだ行として最後に残す（消すと
  // 「あの招待はどうなった」が分からなくなる）。
  const pending = invites.filter((i) => i.status === 'pending')
  const accepted = invites.filter((i) => i.status === 'accepted')
  const declined = invites.filter((i) => i.status === 'declined')

  async function respond(inv: MyInvite, accept: boolean) {
    setBusyId(inv.id)
    try {
      await respondToInvite(inv.id, accept)
      track('invite_respond', { result: accept ? 'accepted' : 'declined' })
      await reload()
      if (accept) setOpenId(inv.id)
    } catch (e) {
      console.error('invite response failed:', e)
      alert(t('invite.errGeneric'))
    } finally {
      setBusyId(null)
    }
  }

  async function toggleWork(inv: MyInvite, artworkId: string) {
    const next = inv.submittedIds.includes(artworkId)
      ? inv.submittedIds.filter((id) => id !== artworkId)
      : [...inv.submittedIds, artworkId]
    setBusyId(inv.id)
    try {
      await setMySubmissions(inv.expoId, next)
      track('invite_submit', { count: next.length })
      await reload()
    } catch (e) {
      console.error('submission failed:', e)
      alert(t('invite.errGeneric'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="me-card invite-inbox">
      <p className="invite-inbox-title">{t('invite.inboxTitle')}</p>

      {[...pending, ...accepted].map((inv) => {
        const organizer = inv.expo.organizer
        const who = organizer?.displayName || (organizer?.username ? `@${organizer.username}` : '')
        const open = openId === inv.id
        return (
          <div key={inv.id} className="invite-row">
            <div className="invite-row-head">
              <span className="invite-room">{inv.expo.title || inv.expo.slug}</span>
              <span className="invite-who">{t('invite.from', { name: who })}</span>
            </div>

            {inv.status === 'pending' ? (
              <>
                <p className="me-note invite-explain">{t('invite.explain')}</p>
                <div className="hako-actions">
                  <button
                    className="btn-line"
                    disabled={busyId === inv.id}
                    onClick={() => void respond(inv, true)}
                  >
                    {t('invite.accept')}
                  </button>
                  <button
                    className="btn-line"
                    disabled={busyId === inv.id}
                    onClick={() => void respond(inv, false)}
                  >
                    {t('invite.decline')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="me-note invite-explain">
                  {inv.submittedIds.length === 0
                    ? t('invite.noneSubmitted')
                    : t('invite.submittedCount', { count: inv.submittedIds.length })}
                </p>
                <div className="hako-actions">
                  <button className="btn-line" onClick={() => setOpenId(open ? null : inv.id)}>
                    {open ? t('invite.hideWorks') : t('invite.chooseWorks')}
                  </button>
                  {/* 降りる道は常に開けておく。0047 のトリガが提出も掛かっている作品も
                      引き上げるので、これは本当に「降りる」ボタン。 */}
                  <button
                    className="btn-line"
                    disabled={busyId === inv.id}
                    onClick={() => {
                      if (confirm(t('invite.leaveConfirm'))) void respond(inv, false)
                    }}
                  >
                    {t('invite.leave')}
                  </button>
                </div>

                {open && (
                  <>
                    {cloudArtworks.length === 0 ? (
                      <p className="me-note invite-explain">{t('invite.noWorks')}</p>
                    ) : (
                      <div className="place-tray invite-tray">
                        {cloudArtworks.map((art) => {
                          const on = inv.submittedIds.includes(art.id)
                          return (
                            <button
                              key={art.id}
                              type="button"
                              className={`place-tray-item${on ? ' picked' : ''}`}
                              disabled={busyId === inv.id}
                              aria-pressed={on}
                              title={art.title}
                              onClick={() => void toggleWork(inv, art.id)}
                            >
                              {art.thumb ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  crossOrigin="anonymous"
                                  src={art.card ?? art.thumb}
                                  srcSet={artworkSrcSet(art, 'card')}
                                  alt=""
                                />
                              ) : (
                                <span className="place-tray-vid">▣</span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    <p className="me-note invite-explain">{t('invite.chooseHint')}</p>
                  </>
                )}
              </>
            )}
          </div>
        )
      })}

      {declined.map((inv) => (
        <div key={inv.id} className="invite-row invite-row-declined">
          <div className="invite-row-head">
            <span className="invite-room">{inv.expo.title || inv.expo.slug}</span>
            <span className="invite-who">{t('invite.youDeclined')}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ============================ 主催者側: 参加者 ============================ */

export function ParticipantsPanel({
  expoId,
  onChanged,
}: {
  expoId: string
  /** 招待の増減で配置トレイの中身が変わるので、親に読み直させる。 */
  onChanged?: () => void
}) {
  const t = useT()
  const [invites, setInvites] = useState<ExpoInvite[] | null>(null)
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setInvites(await listExpoInvites(expoId))
    } catch (e) {
      console.error('could not load participants (is migration 0047 applied?):', e)
      setInvites([])
    }
  }, [expoId])

  useEffect(() => {
    void reload()
  }, [reload])

  async function invite() {
    const raw = handle.trim()
    if (!raw) return
    setBusy(true)
    setErr(null)
    try {
      await inviteArtistToExpo(expoId, raw)
      track('participant_invite', {})
      setHandle('')
      await reload()
      onChanged?.()
    } catch (e) {
      // DBの例外文を出さずキーに畳む（英語が画面に漏れる／原因が伝わらない）。
      // キーは**リテラルで書く** — 組み立てると check:i18n も grep も見つけられない。
      const reason = inviteErrorKey(e)
      setErr(
        reason === 'notFound' ? t('invite.errNotFound')
        : reason === 'self' ? t('invite.errSelf')
        : reason === 'empty' ? t('invite.errEmpty')
        : reason === 'notYours' ? t('invite.errNotYours')
        : t('invite.errGeneric'),
      )
    } finally {
      setBusy(false)
    }
  }

  async function revoke(inv: ExpoInvite) {
    if (!confirm(t('invite.revokeConfirm', { name: inv.artist.displayName }))) return
    setBusy(true)
    try {
      await revokeInvite(inv.id)
      track('participant_revoke', {})
      await reload()
      onChanged?.()
    } catch (e) {
      console.error('revoke failed:', e)
      alert(t('invite.errGeneric'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="participants">
      <p className="placement-title">{t('invite.participantsTitle')}</p>
      <p className="me-note">{t('invite.participantsHelp')}</p>

      <div className="participants-add">
        <input
          type="text"
          className="participants-handle"
          value={handle}
          placeholder={t('invite.handlePlaceholder')}
          aria-label={t('invite.handleLabel')}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setHandle(e.target.value)
            setErr(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void invite()
            }
          }}
        />
        {/* disabled にはしない（AGENTS/LESSONS: 押せないボタンは理由を出せない）。
            空欄のときは invite() が何もせず戻る。 */}
        <button className="btn-line" onClick={() => void invite()}>
          {busy ? t('invite.inviting') : t('invite.invite')}
        </button>
      </div>
      {err && <p className="me-error">{err}</p>}

      {invites === null ? (
        <p className="me-note">{t('me.loading')}</p>
      ) : invites.length === 0 ? (
        <p className="me-note">{t('invite.noParticipants')}</p>
      ) : (
        <ul className="participants-list">
          {invites.map((inv) => (
            <li key={inv.id} className="participants-item">
              {inv.artist.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img crossOrigin="anonymous" className="feed-card-avatar" src={inv.artist.avatarUrl} alt="" />
              ) : (
                <span className="feed-card-avatar empty">·</span>
              )}
              <span className="participants-name">
                {inv.artist.displayName || (inv.artist.username ? `@${inv.artist.username}` : '')}
              </span>
              {/* クラス名は**リテラルで書く**。`is-${status}` と組み立てると
                  check:css が「マークアップに無いCSS」として落とす（実際に落ちた）。 */}
              <span
                className={
                  inv.status === 'accepted'
                    ? 'participants-status is-accepted'
                    : 'participants-status'
                }
              >
                {inv.status === 'pending'
                  ? t('invite.statusPending')
                  : inv.status === 'accepted'
                    ? t('invite.statusSubmitted', { count: inv.submittedCount })
                    : t('invite.statusDeclined')}
              </span>
              <button
                className="participants-remove"
                disabled={busy}
                aria-label={t('invite.revoke')}
                title={t('invite.revoke')}
                onClick={() => void revoke(inv)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
