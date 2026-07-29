'use client'
// Structured per-work design panel. The domain is hierarchical — a frame HAS a
// material, a colour, a mat and a thickness; display is how it hangs and is
// captioned — so the controls are grouped that way instead of flat chip rows,
// and each attribute gets its natural control: switches for presence, a
// segmented control for material, colour dots for colours, a slider for width.
import { useRef } from 'react'
import {
  MATS,
  HANGINGS,
  CAPTIONS,
  FRAME_MATERIALS,
  FRAME_COLORS,
  FRAME_BAR_MM,
  frameDefFor,
  frameSpecFor,
  makeFrameKey,
  type FrameMaterial,
} from '@/lib/presets'
import { HangingIcon, CaptionIcon } from '@/components/SpacePreviews'
import { getEntitlements, isFrameUnlocked } from '@/lib/entitlements'
import { usePurchasedIds } from '@/lib/purchases'
import { useGallery } from '@/lib/store'
import { useT } from '@/components/I18nProvider'

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`
// Mat swatches: 'auto' wears the frame's own recommended colour (dashed ring)
const MAT_SWATCHES = ['auto', 'white', 'ivory', 'grey', 'black'] as const

export default function WorkDesign({
  frameKey,
  matKey,
  hangingKey,
  captionKey,
  onFrame,
  onMat,
  onHanging,
  onCaption,
}: {
  frameKey: string
  matKey: string
  hangingKey: string
  captionKey: string
  onFrame: (key: string) => void
  onMat: (key: string) => void
  onHanging: (key: string) => void
  onCaption: (key: string) => void
}) {
  const t = useT()
  // This panel (material × colour × width) is free for everyone, so it must never
  // serialise a spec down to a PAID preset id — that would hand over ownership of
  // a frame nobody bought. Parametric keys render identically; only the id is
  // withheld (lib/presets → makeFrameKey).
  const user = useGallery((s) => s.user)
  const owned = usePurchasedIds(user?.id ?? null)
  const entitlements = getEntitlements(user?.id ?? null, owned)
  const spec = frameSpecFor(frameKey)
  // Remember the last framed look so switching the frame off and on restores it
  const lastFramed = useRef(spec.framed ? frameKey : 'black')
  if (spec.framed) lastFramed.current = frameKey

  const set = (p: Partial<Omit<typeof spec, 'framed'>>) =>
    onFrame(
      makeFrameKey({ material: spec.material, color: spec.color, barMm: spec.barMm, ...p }, (key) =>
        isFrameUnlocked(key, entitlements)
      )
    )

  const autoMatColor = frameDefFor(spec.framed ? frameKey : 'black').mat ?? 0xf1ede4

  return (
    <div className="work-design">
      <div className="wd-group">
        <div className="wd-title">
          <span>{t('design.frame')}</span>
          <label className="switch" title={spec.framed ? t('design.framed') : t('design.bareCanvas')}>
            <input
              type="checkbox"
              checked={spec.framed}
              onChange={(e) => onFrame(e.target.checked ? lastFramed.current : 'none')}
            />
            <span className="knob" aria-hidden="true" />
          </label>
        </div>
        {spec.framed ? (
          <>
            <div className="wd-row">
              <span className="wd-label">{t('design.material')}</span>
              <div className="seg" role="group" aria-label={t('design.frameMaterial')}>
                {(Object.entries(FRAME_MATERIALS) as [FrameMaterial, { label: string }][]).map(([key, m]) => (
                  <button
                    key={key}
                    type="button"
                    className={key === spec.material ? 'active' : ''}
                    onClick={() => set({ material: key })}
                  >
                    {t(`presets.frameMaterial.${key}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="wd-row">
              <span className="wd-label">{t('design.color')}</span>
              <div className="swatches" role="group" aria-label={t('design.frameColor')}>
                {FRAME_COLORS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`swatch${c.hex === spec.color ? ' active' : ''}`}
                    style={{ background: hex(c.hex) }}
                    title={t(`presets.frameColor.${c.key}`)}
                    aria-label={t('presets.frameOf', { name: t(`presets.frameColor.${c.key}`) })}
                    onClick={() => set({ color: c.hex })}
                  />
                ))}
              </div>
            </div>
            <div className="wd-row">
              <span className="wd-label">{t('design.thickness')}</span>
              <div className="wd-slider">
                <input
                  type="range"
                  min={FRAME_BAR_MM.min}
                  max={FRAME_BAR_MM.max}
                  step={5}
                  value={spec.barMm}
                  aria-label={t('design.frameThickness')}
                  onChange={(e) => set({ barMm: Number(e.target.value) })}
                />
                <span className="wd-value">{(spec.barMm / 10).toFixed(1)}cm</span>
              </div>
            </div>
            <div className="wd-row">
              <span className="wd-label">{t('design.mat')}</span>
              <label className="switch" title={matKey === 'none' ? t('design.noMat') : t('design.withMat')}>
                <input
                  type="checkbox"
                  checked={matKey !== 'none'}
                  onChange={(e) => onMat(e.target.checked ? 'auto' : 'none')}
                />
                <span className="knob" aria-hidden="true" />
              </label>
              {matKey !== 'none' && (
                <div className="swatches" role="group" aria-label={t('design.matColor')}>
                  {MAT_SWATCHES.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`swatch${key === 'auto' ? ' auto' : ''}${matKey === key ? ' active' : ''}`}
                      style={{ background: hex(key === 'auto' ? autoMatColor : MATS[key].color!) }}
                      title={t(`presets.mat.${key}`)}
                      aria-label={t('presets.matAria', { name: t(`presets.mat.${key}`) })}
                      onClick={() => onMat(key)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="wd-note">{t('design.bareCanvasNote')}</p>
        )}
      </div>

      <div className="wd-group">
        <div className="wd-title"><span>{t('design.display')}</span></div>
        <div className="wd-row">
          <span className="wd-label">{t('design.hanging')}</span>
          <div className="chips">
            {Object.entries(HANGINGS).map(([key, def]) => (
              <button
                key={key}
                type="button"
                className={`chip chip-visual${key === hangingKey ? ' active' : ''}`}
                onClick={() => onHanging(key)}
              >
                <HangingIcon hangingKey={key} />
                {t(`presets.hanging.${key}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="wd-row">
          <span className="wd-label">{t('design.caption')}</span>
          <div className="chips">
            {Object.entries(CAPTIONS).map(([key, def]) => (
              <button
                key={key}
                type="button"
                className={`chip chip-visual${key === captionKey ? ' active' : ''}`}
                onClick={() => onCaption(key)}
              >
                <CaptionIcon captionKey={key} />
                {t(`presets.caption.${key}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
