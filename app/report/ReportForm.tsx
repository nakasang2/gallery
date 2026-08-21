'use client'
import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { submitReport, ReportRateLimitedError, type ReportKind } from '@/lib/engagement'
import AuthShell from '@/components/auth/AuthShell'
import { LocaleLink, useT } from '@/components/I18nProvider'

// 通報の入口は1つだが、著作権の申立てだけは米国 17 U.S.C. §512(c)(3) が
// ①申立人の署名 ②著作物の特定 ③連絡先 ④善意の申立てと偽証罰の下での宣誓
// を要求する（無いと有効な通知にならず、§512セーフハーバーの前提が立たない）。
// **嫌がらせの報告に偽証罰の宣誓を求めるのは筋が違う**ので、種別を選ばせて
// 著作権のときだけ追加の欄を出す（ユーザー決定 2026-08-12・D-4）。
// 許可される種別は migration 0056 の `reports_kind_check` と同じ集合。
const KINDS: { value: ReportKind; key: string }[] = [
  { value: 'copyright', key: 'report.kindCopyright' },
  { value: 'harassment', key: 'report.kindHarassment' },
  { value: 'illegal', key: 'report.kindIllegal' },
  { value: 'other', key: 'report.kindOther' },
]

export default function ReportForm({ about }: { about: string }) {
  const t = useT()
  const [aboutInput, setAboutInput] = useState(about)
  const [kind, setKind] = useState<ReportKind>('other')
  const [reason, setReason] = useState('')
  const [contact, setContact] = useState('')
  const [claimant, setClaimant] = useState('')
  const [workIdentified, setWorkIdentified] = useState('')
  const [sworn, setSworn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const isCopyright = kind === 'copyright'

  if (!supabase) {
    return (
      <AuthShell title={t('report.title')}>
        <p className="auth-note">{t('report.unavailable')}</p>
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell title={t('report.thanksTitle')}>
        <p className="auth-note">
          {t('report.thanksBody')}
          <Link href="/terms" style={{ color: 'var(--gold)' }}>{t('footer.terms')}</Link>.
        </p>
        <p className="auth-links">
          <LocaleLink href="/">{t('me.backHome')}</LocaleLink>
        </p>
      </AuthShell>
    )
  }

  /** 足りないものを1つだけ返す（全部並べると読み飛ばされる）。
   *  **順序は画面の並びと同じ**にしてある — 下にあるものを先に指摘すると、
   *  直す場所を探して上下することになる。 */
  function firstProblem(): string {
    if (!isCopyright) return ''
    if (!workIdentified.trim()) return t('report.needWork')
    if (!claimant.trim()) return t('report.needClaimant')
    if (!contact.trim()) return t('report.needContact')
    if (!sworn) return t('report.needSworn')
    return ''
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!reason.trim() || busy) return
    const problem = firstProblem()
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    setBusy(true)
    try {
      await submitReport({
        about: aboutInput,
        reason,
        contact,
        kind,
        // 著作権以外では法定要件の欄を出していないので、値も送らない
        claimant: isCopyright ? claimant : '',
        workIdentified: isCopyright ? workIdentified : '',
        sworn: isCopyright ? sworn : false,
      })
      setDone(true)
    } catch (err) {
      console.error('report submit failed (is 0010_reports.sql applied?):', err)
      setError(err instanceof ReportRateLimitedError ? t('report.rateLimited') : t('report.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title={t('report.title')}>
      <form onSubmit={(e) => void submit(e)}>
        <label className="auth-field">
          <span>{t('report.whatLabel')}</span>
          <input
            type="text"
            placeholder={t('report.whatPlaceholder')}
            required
            value={aboutInput}
            onChange={(e) => setAboutInput(e.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>{t('report.kindLabel')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {t(k.key)}
              </option>
            ))}
          </select>
        </label>
        <label className="auth-field">
          <span>{t('report.whyLabel')}</span>
          <textarea
            className="auth-textarea"
            rows={5}
            required
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        {/* 著作権の申立てのときだけ出る法定要件。出したときは全部必須（片方だけ
            埋まった通知は有効にならないので、送れてしまうと本人が損をする） */}
        {isCopyright && (
          <>
            <p className="auth-note">{t('report.dmcaNote')}</p>
            <label className="auth-field">
              <span>{t('report.workLabel')}</span>
              <textarea
                className="auth-textarea"
                rows={3}
                maxLength={1000}
                placeholder={t('report.workPlaceholder')}
                value={workIdentified}
                onChange={(e) => setWorkIdentified(e.target.value)}
              />
            </label>
            <label className="auth-field">
              <span>{t('report.claimantLabel')}</span>
              <input
                type="text"
                placeholder={t('report.claimantPlaceholder')}
                value={claimant}
                onChange={(e) => setClaimant(e.target.value)}
              />
              <small className="auth-hint">{t('report.claimantNote')}</small>
            </label>
          </>
        )}

        <label className="auth-field">
          {/* 著作権のときは連絡先が法定要件（§512(c)(3)(A)(iv)）なのでラベルも変える */}
          <span>{isCopyright ? t('report.contactRequiredLabel') : t('report.contactLabel')}</span>
          <input
            type={isCopyright ? 'email' : 'text'}
            placeholder={t('report.contactPlaceholder')}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
        </label>

        {/* 宣誓は**全部書き終えたあと・送信ボタンの直前**に置く（何に対して誓うのかが
            出揃っていない状態で先に誓わせない）。`firstProblem()` の順序もこの並びに
            合わせてある — 画面の下にあるものを先に指摘すると直す場所が探せない。
            サインアップの同意行と同じ `.auth-consent` を使い回す（見た目を2つ持たない） */}
        {isCopyright && (
          <label className="auth-consent">
            <input type="checkbox" checked={sworn} onChange={(e) => setSworn(e.target.checked)} />
            <span>{t('report.swornLabel')}</span>
          </label>
        )}

        {error && <p className="me-error">{error}</p>}
        <button className="auth-submit" disabled={busy || !reason.trim()} type="submit">
          {t('report.send')}
        </button>
      </form>
    </AuthShell>
  )
}
