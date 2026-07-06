'use client'
// 作品情報パネル(鑑賞中の作品の解説と、その作品だけの額装変更)
import { FRAMES } from '@/lib/presets'
import { useExhibitionList, frameKeyFor } from '@/lib/exhibition'
import { useGallery, useSettings } from '@/lib/store'

export default function ArtworkPanel() {
  const focusedIndex = useGallery((s) => s.focusedIndex)
  const setFocused = useGallery((s) => s.setFocused)
  const setTourActive = useGallery((s) => s.setTourActive)
  const updateSettings = useGallery((s) => s.updateSettings)
  const visitor = useGallery((s) => s.visitor)
  const settings = useSettings()

  const list = useExhibitionList()
  const art = focusedIndex >= 0 ? list[focusedIndex] : null
  const open = !!art

  return (
    <aside id="panel" className={`panel${open ? ' open' : ''}`} aria-hidden={!open}>
      <button
        className="panel-close"
        aria-label="閉じる"
        onClick={() => {
          setTourActive(false)
          setFocused(-1)
        }}
      >
        ×
      </button>
      {art && (
        <>
          <div className="panel-no">No. {String(focusedIndex + 1).padStart(2, '0')}</div>
          <h2 className="panel-title">{art.title}</h2>
          <div className="panel-artist">{art.artist} — {art.year}</div>
          <p className="panel-desc">{art.desc}</p>
          <div className="panel-tags">
            {(art.tags || []).map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          {/* 来場者モードでは額装は変えられない */}
          {!visitor && (
            <div className="panel-frame">
              <div className="panel-frame-label">この作品の額装</div>
              <div className="chips">
                {Object.entries(FRAMES).map(([key, def]) => (
                  <button
                    key={key}
                    className={`chip${frameKeyFor(settings, art) === key ? ' active' : ''}`}
                    onClick={() => updateSettings({ frameOverrides: { ...settings.frameOverrides, [art.id]: key } })}
                  >
                    {def.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  )
}
