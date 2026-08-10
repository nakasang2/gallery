// 招待リンクの着地点: `xibit360.art/join/{token}`（migration 0048、ユーザー決定 2026-08-10）
//
// 主催者が配る1本のURL。踏んだ人に**まず展示を見せて**から「参加したい」を出させ、
// 主催者が承認する（ユーザー決定）。何に誘われたのか分からないまま登録を求めない。
//
// **ここでは何も公開されない。** 出せるのは `requested` までで、承認されるまで作品は
// 1点も出せず（`may_submit_to_expo` は `accepted` しか見ない）、壁にも掛からない。
// だからリンクが流出しても実害は「承認待ちが増える」だけで、主催者が無効化できる。
//
// `/expo/{name}` とは別のURL体系にしてある: あちらは**来場者**が見る公開ページ、こちらは
// **作家**への案内。会期前（下書き）のあいだも開ける必要があるので、公開ページの条件
// （会期が生きている）とは噛み合わない。
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useT } from '@/components/I18nProvider'
import { supabase } from '@/lib/supabase'
import { fetchJoinTarget, requestInvite, type InviteStatus, type JoinTarget } from '@/lib/invites'
import { inviteLinkPath } from '@/lib/invites'
import { withNext } from '@/lib/afterAuth'
import { track } from '@/lib/analytics'

export default function JoinPage() {
  const t = useT()
  const params = useParams<{ token: string }>()
  const token = typeof params.token === 'string' ? params.token : ''
  /** サインイン済みか。**ストアの `user` を待たない** — あれは `onAuthStateChange` で
   *  後から入るので、初回描画では常に null＝未ログイン扱いになり、ログイン済みの人に
   *  一瞬［登録する］が出る。ここは自分でセッションを取って確定させる。 */
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined)
  const [target, setTarget] = useState<JoinTarget | null | undefined>(undefined)
  const [status, setStatus] = useState<InviteStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!token || !supabase) {
      setTarget(null)
      setSignedIn(false)
      return
    }
    // **セッションの復元を先に待つ。** `my_status` は `auth.uid()` で決まるので、
    // セッションが載る前に引くと「関わりが無い」に見え、既に参加している人にまで
    // ［参加したい］が出る。`getSession()` は復元が終わるまで待ってくれる。
    const { data: auth } = await supabase.auth.getSession()
    setSignedIn(!!auth.session?.user)
    const found = await fetchJoinTarget(token)
    setTarget(found)
    setStatus(found?.myStatus ?? null)
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function request() {
    setBusy(true)
    setErr('')
    try {
      const next = await requestInvite(token)
      setStatus(next)
      track('expo_join_request', { result: next })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (signedIn === undefined || target === undefined) {
    return (
      <main className="join-page">
        <p className="me-note">{t('me.loading')}</p>
      </main>
    )
  }

  // 無効なトークン・止めたリンク。**理由は言わない**（「無効です」と「そんなリンクは
  // 無い」を区別すると、総当たりで有効なトークンを探せる ── 0048 の関数も同じ理由で
  // 0行を返すだけにしてある）。
  if (target === null) {
    return (
      <main className="join-page">
        <h1 className="join-title">{t('join.deadTitle')}</h1>
        <p className="me-note">{t('join.deadBody')}</p>
        <Link className="btn-line" href="/explore">
          {t('join.browse')}
        </Link>
      </main>
    )
  }

  const name = target.title || target.slug

  return (
    <main className="join-page">
      <p className="join-kicker">{t('join.kicker')}</p>
      <h1 className="join-title">{name}</h1>
      <p className="join-by">{t('join.by', { name: target.organizerName })}</p>
      {target.statement && <p className="join-statement">{target.statement}</p>}

      {/* 会期。まだ始まっていない展示のほうが普通なので、**日付が無いことを異常として
          見せない**。どちらの文を出すかは `startsAt`/`endsAt`（＝支払いで入る値）から
          導出しており、旗を別に持っていない。 state-ok: 出どころは expos.starts_at/ends_at */}
      <p className="me-note join-run">
        {target.startsAt && target.endsAt
          ? t('join.runs', {
              from: new Date(target.startsAt).toLocaleDateString(),
              to: new Date(target.endsAt).toLocaleDateString(),
            })
          : t('join.notOpenYet')}
      </p>

      <div className="join-actions">
        {!signedIn ? (
          <>
            <p className="me-note">{t('join.needAccount')}</p>
            {/* 登録・サインインのあと**このリンクに戻す**（戻さないと「登録したけど
                何に誘われたのか分からない」で終わる）。 */}
            <Link className="btn-line btn-gold" href={withNext('/signup', inviteLinkPath(token))}>
              {t('join.signUp')}
            </Link>
            <Link className="btn-line" href={withNext('/signin', inviteLinkPath(token))}>
              {t('join.signIn')}
            </Link>
          </>
        ) : status === 'accepted' ? (
          <>
            <p className="me-note">{t('join.alreadyIn')}</p>
            <Link className="btn-line btn-gold" href="/me">
              {t('join.chooseWorks')}
            </Link>
          </>
        ) : status === 'requested' ? (
          <p className="me-note join-waiting">{t('join.waiting')}</p>
        ) : (
          <>
            <p className="me-note">{t('join.explain')}</p>
            <button type="button" className="btn-line btn-gold" disabled={busy} onClick={() => void request()}>
              {busy ? t('common.saving') : t('join.request')}
            </button>
          </>
        )}
      </div>

      {err && <p className="me-error">{err}</p>}
    </main>
  )
}
