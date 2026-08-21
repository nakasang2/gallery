'use client'
// 管理画面から差し替えるLPの画像枠（migration 0018 の `site_config`）。
//
// 元は components/LpHeroEditor だけが持っていた画面。**LPの3Dに掛かる絵は5面・23枠
// あるが、操作も保存の形も完全に同じ**なので、写して5本にせずここに寄せた
// （DECISIONS 2026-08-12 の絶対ルール「同じ意味の処理を2か所で書かない」）。
// 違うのは「見出し・説明・帯の構成（枠数・ラベル・保存先・アップロードの枠番号）」
// だけで、全部このpropsで渡ってくる。
//
// **1つの節に帯を複数持てる**（ユーザー選択 2026-08-20 A案）。カメラの旅路と同じ
// 3節（1st View / 廊下 / 最後の部屋）に畳みたいが、節の中には性質の違う枠がある
// ── 廊下なら「訴求パネルの隣の絵」と「通路の額入り作品」。帯にすると、節の見出しで
// 場所が分かり、帯の見出しでその中の役割が分かる。**保存は帯ごとに独立**（1帯＝
// site_config の1行）で、ボタンは節に1つ ── 押すと変更のあった帯だけを書く。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useGallery } from '@/lib/store'
import { uploadLpImage } from '@/lib/cloud'
import type { LpHeroSlot, SlotsFetch } from '@/lib/siteConfig'
import { useT } from '@/components/I18nProvider'

export interface LpImageBand {
  /** 帯の小見出し。節に帯が1つだけのときは省く（見出しが二重になる） */
  titleKey?: string
  count: number
  /** 枠ごとのラベルの辞書キー。枠数より短ければ残りは番号だけで出す */
  labelKeys: readonly string[]
  /** 枠が空のときの控えの言い方。ヒーロー・通路・大部屋は内蔵のデモ作品で埋まるが、
   *  訴求パネルは何も掛からない ── 面によって「空」の意味が違うので呼び手が決める */
  emptyLabelKey: string
  /** アップロード先 `{uid}/lp/{slot}-{nonce}.jpg` の枠番号の起点。帯どうしでファイルを
   *  取り合わないよう、帯ごとに別の帯番号を使う（lib/siteConfig に理由） */
  slotOffset: number
  fetchSlots: () => Promise<SlotsFetch>
  saveSlots: (slots: LpHeroSlot[]) => Promise<void>
}

export interface LpImageSlotsEditorProps {
  /** 節の見出し（辞書で解決済みの文字列ではなくキー） */
  headingKey: string
  noteKey: string
  applyNoteKey: string
  bands: readonly LpImageBand[]
}

export default function LpImageSlotsEditor({ headingKey, noteKey, applyNoteKey, bands }: LpImageSlotsEditorProps) {
  const t = useT()
  const user = useGallery((s) => s.user)
  const [slots, setSlots] = useState<LpHeroSlot[][]>(() => bands.map((b) => Array<LpHeroSlot>(b.count).fill(null)))
  const [loaded, setLoaded] = useState(false)
  /** 帯ごとの読み込み結果。false は「未設定」ではなく本物の失敗（リリース前監査
   *  #19）── この状態のまま保存すると、読めなかっただけの既存の枠を空で上書きする。 */
  const [bandOk, setBandOk] = useState<boolean[]>(() => bands.map(() => true))
  const anyBandFailed = bandOk.some((ok) => !ok)
  /** いま上げている枠（`帯:枠`）。保存中は別の旗で持つ ── 以前は保存を `-1` で
   *  表していたが、帯が増えて枠の識別に2つの数が要るようになった */
  const [busy, setBusy] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState<boolean[]>(() => bands.map(() => false))
  const anyDirty = dirty.some(Boolean)
  const locked = busy !== null || saving
  // Guards against setState after unmount (navigating away mid-save/upload)
  const alive = useRef(true)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Fetches only the given band indices and writes results back at those exact
   *  positions — NOT a blanket "refetch everything". A retry that reloaded every
   *  band would also overwrite bands that loaded fine on the first try, silently
   *  discarding any edit the admin already made there while waiting for the
   *  failed band's retry (別視点レビューで発見・2026-08-21: the first version of
   *  this retry button did exactly that). */
  const loadBands = useCallback(
    (indices: number[]) => {
      Promise.all(
        indices.map((b) => bands[b].fetchSlots().catch((): SlotsFetch => ({ slots: Array<LpHeroSlot>(bands[b].count).fill(null), ok: false })))
      )
        .then((results) => {
          if (!alive.current) return
          setSlots((prev) => prev.map((row, bi) => results[indices.indexOf(bi)]?.slots ?? row))
          setBandOk((prev) => prev.map((ok, bi) => results[indices.indexOf(bi)]?.ok ?? ok))
          setLoaded(true)
        })
        .catch(() => {
          if (!alive.current) return
          setBandOk((prev) => prev.map((ok, bi) => (indices.includes(bi) ? false : ok)))
          setLoaded(true)
        })
    },
    [bands]
  )

  /** Re-tries only the bands that failed. Warns first if any of them already has
   *  an unsaved edit — that band's Save is blocked while it's `!ok` anyway (see
   *  the button below), so the only way to reach this state is uploading into a
   *  slot before noticing the load-failure banner. */
  function retryFailedBands() {
    const failed = bandOk.flatMap((ok, b) => (ok ? [] : [b]))
    if (!failed.length) return
    if (failed.some((b) => dirty[b]) && !window.confirm(t('adminUi.lpRetryDiscardsEdit'))) return
    loadBands(failed)
  }

  useEffect(() => {
    alive.current = true
    setLoaded(false)
    loadBands(bands.map((_, i) => i))
    return () => {
      alive.current = false
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bands])

  function put(b: number, i: number, value: LpHeroSlot) {
    setSlots((prev) => prev.map((row, bi) => (bi === b ? row.map((s, k) => (k === i ? value : s)) : row)))
    setDirty((prev) => prev.map((d, bi) => (bi === b ? true : d)))
  }

  async function onFile(b: number, i: number, file: File | undefined) {
    if (!file || !user) return
    setBusy(`${b}:${i}`)
    try {
      const img = await uploadLpImage(user.id, bands[b].slotOffset + i, file)
      if (!alive.current) return
      put(b, i, img)
    } catch (e) {
      if (alive.current) alert(t('adminUi.uploadFailed', { msg: String(e instanceof Error ? e.message : e) }))
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  async function save() {
    setSaving(true)
    try {
      // 変更のあった帯だけを書く。触っていない帯まで upsert すると、他の管理者が
      // 別のタブで直した内容を読み込み時点の値で上書きしてしまう。
      for (let b = 0; b < bands.length; b++) {
        if (dirty[b]) await bands[b].saveSlots(slots[b])
      }
      if (!alive.current) return
      setSaved(true)
      setDirty(bands.map(() => false))
      savedTimer.current = setTimeout(() => setSaved(false), 1800)
    } catch (e) {
      if (alive.current) alert(t('adminUi.saveFailed', { msg: String(e instanceof Error ? e.message : e) }))
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  return (
    <section className="me-section">
      <h2>{t(headingKey)}</h2>
      <div className="me-card">
        <p className="me-note" style={{ marginTop: 0 }}>
          {t(noteKey)}
        </p>
        {anyBandFailed && (
          <p className="me-error">
            {t('adminUi.lpLoadFailed')}{' '}
            <button className="btn-line" type="button" onClick={retryFailedBands}>
              {t('common.retry')}
            </button>
          </p>
        )}
        {bands.map((band, b) => (
          <div key={b} style={{ marginTop: b === 0 ? 0 : '1.4rem' }}>
            {band.titleKey && (
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: '0.66rem',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--muted)',
                  borderTop: b === 0 ? 'none' : '1px solid var(--hairline)',
                  paddingTop: b === 0 ? 0 : '1.1rem',
                  marginTop: '0.8rem',
                }}
              >
                {t(band.titleKey)}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginTop: '0.8rem' }}>
              {Array.from({ length: band.count }).map((_, i) => {
                const s = slots[b]?.[i] ?? null
                const uploading = busy === `${b}:${i}`
                return (
                  <div key={i} style={{ border: '1px solid var(--hairline)', borderRadius: 8, padding: '0.8rem' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.6rem' }}>
                      {/* i18n-ok: 枠が増えたときの控え。番号だけなので訳す対象ではない */}
                      {band.labelKeys[i] ? t(band.labelKeys[i]) : `#${i + 1}`}
                    </div>
                    <div style={{ aspectRatio: '4 / 3', background: '#0d0c0b', border: '1px solid var(--hairline)', borderRadius: 4, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {s ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img crossOrigin="anonymous" src={s.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{t(band.emptyLabelKey)}</span>
                      )}
                    </div>
                    <div className="hako-actions" style={{ marginTop: '0.6rem' }}>
                      <label className="btn-line file-btn" aria-disabled={uploading} style={{ marginTop: 0 }}>
                        {uploading ? t('me.uploading') : s ? t('adminUi.replace') : t('adminUi.upload')}
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          disabled={locked || !bandOk[b]}
                          onChange={(e) => {
                            void onFile(b, i, e.target.files?.[0])
                            e.target.value = ''
                          }}
                        />
                      </label>
                      {s && (
                        <button className="btn-line" disabled={locked || !bandOk[b]} onClick={() => put(b, i, null)}>
                          {t('adminUi.clear')}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        <div className="hako-actions" style={{ marginTop: '1rem' }}>
          <button className="btn-line btn-gold" disabled={!loaded || locked || !anyDirty || anyBandFailed} onClick={() => void save()}>
            {saved ? t('adminUi.saved') : saving ? t('adminUi.saving') : t('common.save')}
          </button>
        </div>
        <p className="me-note">{t(applyNoteKey)}</p>
      </div>
    </section>
  )
}
