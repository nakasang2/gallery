'use client'
// Artwork info panel (details for the focused work, plus per-work framing / visitor likes)
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { walkRef } from '@/lib/controller'
import { useExhibitionList, frameKeyFor, matKeyFor, hangingKeyFor, captionKeyFor, setOverride } from '@/lib/exhibition'
import { frameDefFor, applyMat, resolveTheme } from '@/lib/presets'
import { useGallery, useSettings } from '@/lib/store'
import { addLike, hasLiked } from '@/lib/engagement'
import { sessionFlags, track } from '@/lib/analytics'
import { audioGuide, useGuidePlaying, guideSourceFor, type GuideSource } from '@/lib/guide'
import WorkDesign from '@/components/WorkDesign'
import { useT } from '@/components/I18nProvider'

// The 3D preview pulls in three.js — load it only when a visitor opens it.
const ArtworkPreview3D = dynamic(() => import('./ArtworkPreview3D'), { ssr: false })

// Play/pause control for a work's audio guide — plays an uploaded narration, or
// reads the caption aloud (src.kind === 'tts') when there's no recording.
function AudioGuideButton({ source }: { source: GuideSource }) {
  const t = useT()
  const playing = useGuidePlaying(source.key)
  const label = t('artwork.readAloud')
  return (
    <button
      className={`panel-guide${playing ? ' playing' : ''}`}
      onClick={() => audioGuide.toggle(source)}
      aria-label={playing ? t('artwork.pauseGuide') : t('artwork.playGuide')}
    >
      <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span> {label}
    </button>
  )
}

// The artist may type "myshop.com/item" without a protocol — assume https
function toHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

// Fallback text for a purchase link the artist left unlabelled, beyond the first
// (the first keeps the old price/"for sale" wording). Without this, two unlabelled
// links both read "For sale" with no way to tell which button goes where
// (別視点レビュー確定 2026-08-12).
function hostnameFallback(url: string, forSale: string): string {
  try {
    return new URL(toHref(url)).hostname.replace(/^www\./, '')
  } catch {
    return forSale
  }
}

// Visitor-only like button (anonymous; dedupe per browser)
/** 来場者のいいね。**数は出さない**（ユーザー指示 2026-08-12）。
 *  数を隠したので件数の取得もやめた ── 表示に使っていただけなので、作品を開くたびの
 *  往復が1つ減る。作家向けの集計は `likeCountsByArtwork`（別経路）が持っている。 */
function LikeButton({ galleryId, artworkId }: { galleryId: string; artworkId: string }) {
  const [liked, setLiked] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setLiked(hasLiked(artworkId))
  }, [artworkId])

  async function like() {
    if (liked || busy) return
    setBusy(true)
    try {
      await addLike(galleryId, artworkId)
      setLiked(true)
      sessionFlags.liked = true
      track('gallery_like', { gallery_id: galleryId, artwork_id: artworkId })
    } catch {
      /* likes must never interrupt viewing */
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className={`like-btn${liked ? ' liked' : ''}`} disabled={liked || busy} onClick={() => void like()}>
      {liked ? '♥' : '♡'}
    </button>
  )
}

export default function ArtworkPanel() {
  const t = useT()
  const focusedIndex = useGallery((s) => s.focusedIndex)
  const setFocused = useGallery((s) => s.setFocused)
  const setTourActive = useGallery((s) => s.setTourActive)
  const updateSettings = useGallery((s) => s.updateSettings)
  const visitor = useGallery((s) => s.visitor)
  const demoMode = useGallery((s) => s.demoMode)
  const settings = useSettings()

  const tourActive = useGallery((s) => s.tourActive)
  const list = useExhibitionList()
  const art = focusedIndex >= 0 ? list[focusedIndex] : null
  const open = !!art
  const guide = art ? guideSourceFor(art) : null

  // The framed-work look for the 3D preview: same theme + frame/mat the room hangs.
  const theme = resolveTheme(settings.theme, settings.designOverrides)
  const frameDef = art ? applyMat(frameDefFor(frameKeyFor(settings, art)), matKeyFor(settings, art)) : null

  // Full-screen "handle it" preview. Reset when the work changes or the panel closes.
  const [preview3d, setPreview3d] = useState(false)
  const preview3dAt = useRef(0)
  useEffect(() => {
    setPreview3d(false)
  }, [art?.id, open])

  // During the guided tour, each work's guide auto-plays as it comes into focus
  // (the tour is started by a tap, so autoplay is allowed). Any other focus/tour
  // change stops whatever was playing — so moving to a guide-less work, ending
  // the tour, or closing the panel all silence the previous narration. Outside
  // the tour the visitor starts a guide by tapping the button.
  useEffect(() => {
    if (tourActive && guide) audioGuide.play(guide)
    else audioGuide.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art?.id, tourActive])

  // Swiping the sheet itself also pages between works (vertical scroll untouched)
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  /* ---- 「空間で見る」を作品の真下に置く（ユーザー決定 2026-08-12） ----
     パネルの中ではなく、作品そのものの下に浮かせる。位置は3D側から投影して貰う
     （`walkRef.current.focusedScreenRect()`）。
     **毎フレーム追わない**: `focusExhibit` はカメラのトゥイーンが終わってから
     `setFocused` するので、パネルが出た時点でカメラは静止している。追うのは
     「作品が変わった」「画面サイズが変わった」ときだけ。 */
  const [viewBtn, setViewBtn] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    if (!art) {
      setViewBtn(null)
      return
    }
    // 1フレーム待つ: `setFocused` の直後はまだカメラ行列が今フレームぶん更新されていない
    let raf = requestAnimationFrame(() => {
      const place = () => {
        const r = walkRef.current?.focusedScreenRect()
        if (!r) {
          setViewBtn(null)
          return
        }
        // パネルの上端より上に収める。電話では下シート、広い画面では右ドロワーなので
        // 「上端」の意味が変わる ── 実測した矩形で決める（幅ごとの分岐を持たない）
        const panelEl = document.getElementById('panel')
        const pr = panelEl?.getBoundingClientRect()
        const floor = pr && pr.top > window.innerHeight * 0.4 ? pr.top : window.innerHeight
        const GAP = 14
        const BTN_H = 44
        const top = Math.max(8, Math.min(r.bottom + GAP, floor - BTN_H - GAP))
        const left = Math.max(64, Math.min(r.left + r.width / 2, window.innerWidth - 64))
        setViewBtn({ left, top })
      }
      place()
      raf = requestAnimationFrame(place) // 次フレームでもう一度（行列が確定した後）
    })
    const onResize = () => {
      const r = walkRef.current?.focusedScreenRect()
      if (!r) return
      const panelEl = document.getElementById('panel')
      const pr = panelEl?.getBoundingClientRect()
      const floor = pr && pr.top > window.innerHeight * 0.4 ? pr.top : window.innerHeight
      setViewBtn({
        left: Math.max(64, Math.min(r.left + r.width / 2, window.innerWidth - 64)),
        top: Math.max(8, Math.min(r.bottom + 14, floor - 44 - 14)),
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, [art?.id, art])

  const viewIn3dButton =
    art && viewBtn && !preview3d ? (
      <button
        className="panel-view3d panel-view3d-float"
        style={{ left: viewBtn.left, top: viewBtn.top }}
        onClick={() => {
          preview3dAt.current = Date.now()
          track('gallery_work_preview3d', { gallery_id: visitor?.galleryId, artwork_id: art.id })
          setPreview3d(true)
        }}
      >
        <span aria-hidden="true">⛶</span> {t('artwork.viewIn3D')}
      </button>
    ) : null

  // 次/前で切り替えたことをスクリーンリーダーへ伝える（U3・2026-08-16）。
  // フォーカスはボタンに残したまま短く読み上げる ── パネルへフォーカスを飛ばすと
  // 連打で次々フォーカスが移動して体験が重くなるため（決定はユーザー承認済み）。
  // **常時マウントされた領域の中身だけを変える**: `aria-hidden`/`inert` が切り替わる
  // 要素の中に live region を置くと、ATによっては変化に気づけない実装がある。
  const announce = art
    ? t('artwork.nowViewing', { no: focusedIndex + 1, count: list.length, title: art.title, artist: art.artist })
    : ''

  return (
    <>
    <div className="sr-only" aria-live="polite" aria-atomic="true">{announce}</div>
    <aside
      id="panel"
      className={`panel${open ? ' open' : ''}`}
      aria-hidden={!open}
      inert={!open}
      onTouchStart={(e) => {
        const t = e.touches[0]
        touchStart.current = { x: t.clientX, y: t.clientY }
      }}
      onTouchEnd={(e) => {
        const s = touchStart.current
        touchStart.current = null
        if (!s) return
        const t = e.changedTouches[0]
        const dx = t.clientX - s.x
        const dy = t.clientY - s.y
        if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          walkRef.current?.focusStep(dx < 0 ? 1 : -1)
        }
      }}
    >
      <button
        className="panel-close"
        aria-label={t('common.close')}
        onClick={() => {
          setTourActive(false)
          setFocused(-1)
        }}
      >
        ×
      </button>
      {art && (
        <>
          {/* Prev/next lives inside the panel now, so the on-canvas stepper can
              hide while a work is open (it otherwise overlaps the artwork). */}
          <div className="panel-nav">
            <button
              className="panel-nav-btn"
              aria-label={t('artwork.previous')}
              onClick={() => walkRef.current?.focusStep(-1)}
            >
              ‹
            </button>
            <span className="panel-nav-count">
              No. {String(focusedIndex + 1).padStart(2, '0')}
              <span className="panel-nav-sep"> / </span>
              {String(list.length).padStart(2, '0')}
            </span>
            <button
              className="panel-nav-btn"
              aria-label={t('artwork.next')}
              onClick={() => walkRef.current?.focusStep(1)}
            >
              ›
            </button>
          </div>
          <h2 className="panel-title">{art.title}</h2>
          <div className="panel-artist">{art.artist} — {art.year}</div>
          {/* Gallery label: dimensions and medium, when the artist gave them */}
          {(() => {
            const dims = art.widthCm && art.heightCm ? `${art.widthCm} × ${art.heightCm} cm` : ''
            const meta = [dims, art.medium].filter(Boolean).join(' · ')
            return meta ? <div className="panel-medium">{meta}</div> : null
          })()}
          {/* The visitor's one reaction deserves a real touch target, not an afterthought */}
          {visitor && <LikeButton galleryId={visitor.galleryId} artworkId={art.id} />}
          {/* 「空間で見る」はパネルの外（作品の真下）へ移した（ユーザー決定 2026-08-12）。
              作品に対する操作なので、作品の近くにある方が結びつきが分かる。下の
              `viewIn3dButton` を参照 ── ここには置かない。 */}
          <p className="panel-desc">{art.desc}</p>
          {/* タグが無ければ行ごと出さない。以前は空でも `<div>` を描いていたが、
              架空のタグ（'Exhibited'）を作るのをやめた（lib/cloud）ので、実ユーザーの
              作品ではここが常に空になる ── 空の箱だけが残ると余白の理由が分からない */}
          {(art.tags?.length ?? 0) > 0 && (
            <div className="panel-tags">
              {art.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          )}
          {guide && <AudioGuideButton source={guide} />}
          {/* Only links with a URL render — a label-only row (still being typed,
              or the URL field left empty) has nowhere to send a click. */}
          {(() => {
            const links = (art.purchaseLinks ?? []).filter((l) => l.url.trim())
            return links.length > 0 ? (
              links.map((link, i) => (
                <a
                  key={i}
                  className="panel-buy"
                  href={toHref(link.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    track('gallery_work_buy_click', {
                      gallery_id: visitor?.galleryId,
                      artwork_id: art.id,
                      has_price: !!art.price,
                    })
                  }
                >
                  {/* A blank label on the first link (the common case: exactly one
                      link, migrated from the old single-URL field) reads as
                      price/"for sale" — same look as before links could be
                      labelled and multiplied. A blank label on any OTHER link
                      falls back to its hostname instead of repeating "for sale"
                      with no way to tell the buttons apart. */}
                  {link.label.trim() ||
                    (i === 0
                      ? `${art.price ? `${art.price} · ` : ''}${t('artwork.forSale')}`
                      : hostnameFallback(link.url, t('artwork.forSale')))}
                </a>
              ))
            ) : (
              art.price && <div className="panel-price">{art.price}</div>
            )
          })()}
          {/* Per-work design editor: owner-editing only. Hidden in the public visitor
              view AND on the /demo showcase (the demo is a curated "sampler" — its
              varied looks are set in code, not tweaked by casual visitors). */}
          {!visitor && !demoMode && (
            <div className="panel-frame">
              <div className="panel-frame-label">{t('artwork.designThisWork')}</div>
              <WorkDesign
                frameKey={frameKeyFor(settings, art)}
                matKey={matKeyFor(settings, art)}
                hangingKey={hangingKeyFor(settings, art)}
                captionKey={captionKeyFor(settings, art)}
                lightKey={
                  settings.lightOverrides[art.id] === 'ceiling' || settings.lightOverrides[art.id] === 'overhead'
                    ? (settings.lightOverrides[art.id] as 'ceiling' | 'overhead')
                    : 'follow'
                }
                onLight={(k) => {
                  const next = { ...settings.lightOverrides }
                  if (k) next[art.id] = k
                  else delete next[art.id]
                  updateSettings({ lightOverrides: next })
                }}
                onFrame={(k) =>
                  updateSettings({ frameOverrides: setOverride(settings.frameOverrides, art.id, k, settings.frame) })
                }
                onMat={(k) =>
                  updateSettings({ matOverrides: setOverride(settings.matOverrides, art.id, k, settings.mat) })
                }
                onHanging={(k) =>
                  updateSettings({ hangingOverrides: setOverride(settings.hangingOverrides, art.id, k, settings.hanging) })
                }
                onCaption={(k) =>
                  updateSettings({ captionOverrides: setOverride(settings.captionOverrides, art.id, k, settings.caption) })
                }
              />
              <p className="settings-note" style={{ marginTop: '0.6rem' }}>
                {t('panel.perWorkOverrideNote')}
              </p>
            </div>
          )}
        </>
      )}
    </aside>
    {/* 作品の真下に浮かぶ「空間で見る」。パネルの外に出しているのは、パネルは
        `position: fixed` で下（または右）に固定されており、その中では作品の位置に
        置けないため。全画面プレビュー中は出さない（自分自身を開くボタンなので） */}
    {viewIn3dButton}
    {preview3d && art && frameDef && (
      <ArtworkPreview3D
        art={art}
        frameDef={frameDef}
        theme={theme}
        onClose={() => {
          track('gallery_work_preview3d_close', {
            gallery_id: visitor?.galleryId,
            artwork_id: art.id,
            ms: Date.now() - preview3dAt.current,
          })
          setPreview3d(false)
        }}
      />
    )}
    </>
  )
}
