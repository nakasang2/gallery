'use client'
// 管理画面から差し替えるLPの画像枠（migration 0018 の `site_config`）。
//
// 元は components/LpHeroEditor だけが持っていた画面。**ヒーローの3枠と、3Dの廊下に
// 並ぶ6枚の訴求パネルの絵で、操作も保存の形も完全に同じ**なので、写して2本にせず
// ここに寄せた（DECISIONS 2026-08-12 の絶対ルール「同じ意味の処理を2か所で書かない」）。
// 違うのは「見出し・説明・枠数・ラベル・どのキーに保存するか・アップロードの枠番号」
// だけで、全部このpropsで渡ってくる。
import { useEffect, useRef, useState } from 'react'
import { useGallery } from '@/lib/store'
import { uploadLpImage } from '@/lib/cloud'
import type { LpHeroSlot } from '@/lib/siteConfig'
import { useT } from '@/components/I18nProvider'

export interface LpImageSlotsEditorProps {
  /** 節の見出し（辞書で解決済みの文字列ではなくキー） */
  headingKey: string
  noteKey: string
  applyNoteKey: string
  count: number
  /** 枠ごとのラベルの辞書キー。枠数より短ければ残りは番号だけで出す */
  labelKeys: readonly string[]
  /** 枠が空のときの控えの言い方。ヒーローは内蔵のデモ作品で埋まるが、パネルは
   *  何も掛からない ── 面によって「空」の意味が違うので呼び手が決める */
  emptyLabelKey: string
  /** アップロード先 `{uid}/lp/{slot}.jpg` の枠番号の起点。面どうしでファイルを
   *  取り合わないよう、面ごとに別の帯を使う（lib/siteConfig に理由） */
  slotOffset: number
  fetchSlots: () => Promise<LpHeroSlot[]>
  saveSlots: (slots: LpHeroSlot[]) => Promise<void>
}

export default function LpImageSlotsEditor({
  headingKey,
  noteKey,
  applyNoteKey,
  count,
  labelKeys,
  emptyLabelKey,
  slotOffset,
  fetchSlots,
  saveSlots,
}: LpImageSlotsEditorProps) {
  const t = useT()
  const user = useGallery((s) => s.user)
  const [slots, setSlots] = useState<LpHeroSlot[]>(() => Array(count).fill(null))
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  // Guards against setState after unmount (navigating away mid-save/upload)
  const alive = useRef(true)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    alive.current = true
    fetchSlots()
      .then((s) => {
        if (!alive.current) return
        setSlots(s)
        setLoaded(true)
      })
      .catch(() => alive.current && setLoaded(true))
    return () => {
      alive.current = false
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [fetchSlots])

  async function onFile(i: number, file: File | undefined) {
    if (!file || !user) return
    setBusy(i)
    try {
      const img = await uploadLpImage(user.id, slotOffset + i, file)
      if (!alive.current) return
      setSlots((prev) => prev.map((s, k) => (k === i ? img : s)))
      setDirty(true)
    } catch (e) {
      if (alive.current) alert(t('adminUi.uploadFailed', { msg: String(e instanceof Error ? e.message : e) }))
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  function clearSlot(i: number) {
    setSlots((prev) => prev.map((s, k) => (k === i ? null : s)))
    setDirty(true)
  }

  async function save() {
    setBusy(-1)
    try {
      await saveSlots(slots)
      if (!alive.current) return
      setSaved(true)
      setDirty(false)
      savedTimer.current = setTimeout(() => setSaved(false), 1800)
    } catch (e) {
      if (alive.current) alert(t('adminUi.saveFailed', { msg: String(e instanceof Error ? e.message : e) }))
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  return (
    <section className="me-section">
      <h2>{t(headingKey)}</h2>
      <div className="me-card">
        <p className="me-note" style={{ marginTop: 0 }}>
          {t(noteKey)}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginTop: '0.8rem' }}>
          {Array.from({ length: count }).map((_, i) => {
            const s = slots[i]
            return (
              <div key={i} style={{ border: '1px solid var(--hairline)', borderRadius: 8, padding: '0.8rem' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.6rem' }}>
                  {/* i18n-ok: 枠が増えたときの控え。番号だけなので訳す対象ではない */}
                  {labelKeys[i] ? t(labelKeys[i]) : `#${i + 1}`}
                </div>
                <div style={{ aspectRatio: '4 / 3', background: '#0d0c0b', border: '1px solid var(--hairline)', borderRadius: 4, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {s ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img crossOrigin="anonymous" src={s.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{t(emptyLabelKey)}</span>
                  )}
                </div>
                <div className="hako-actions" style={{ marginTop: '0.6rem' }}>
                  <label className="btn-line file-btn" aria-disabled={busy === i} style={{ marginTop: 0 }}>
                    {busy === i ? t('me.uploading') : s ? t('adminUi.replace') : t('adminUi.upload')}
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      disabled={busy !== null}
                      onChange={(e) => {
                        void onFile(i, e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                  </label>
                  {s && (
                    <button className="btn-line" disabled={busy !== null} onClick={() => clearSlot(i)}>
                      {t('adminUi.clear')}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <div className="hako-actions" style={{ marginTop: '1rem' }}>
          <button className="btn-line btn-gold" disabled={!loaded || busy !== null || !dirty} onClick={() => void save()}>
            {saved ? t('adminUi.saved') : busy === -1 ? t('adminUi.saving') : t('common.save')}
          </button>
        </div>
        <p className="me-note">{t(applyNoteKey)}</p>
      </div>
    </section>
  )
}
