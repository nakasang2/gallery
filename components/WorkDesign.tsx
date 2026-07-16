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
  const spec = frameSpecFor(frameKey)
  // Remember the last framed look so switching the frame off and on restores it
  const lastFramed = useRef(spec.framed ? frameKey : 'black')
  if (spec.framed) lastFramed.current = frameKey

  const set = (p: Partial<Omit<typeof spec, 'framed'>>) =>
    onFrame(makeFrameKey({ material: spec.material, color: spec.color, barMm: spec.barMm, ...p }))

  const autoMatColor = frameDefFor(spec.framed ? frameKey : 'black').mat ?? 0xf1ede4

  return (
    <div className="work-design">
      <div className="wd-group">
        <div className="wd-title">
          <span>Frame</span>
          <label className="switch" title={spec.framed ? 'Framed' : 'No frame (stretched canvas)'}>
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
              <span className="wd-label">Material</span>
              <div className="seg" role="group" aria-label="Frame material">
                {(Object.entries(FRAME_MATERIALS) as [FrameMaterial, { label: string }][]).map(([key, m]) => (
                  <button
                    key={key}
                    type="button"
                    className={key === spec.material ? 'active' : ''}
                    onClick={() => set({ material: key })}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="wd-row">
              <span className="wd-label">Color</span>
              <div className="swatches" role="group" aria-label="Frame color">
                {FRAME_COLORS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`swatch${c.hex === spec.color ? ' active' : ''}`}
                    style={{ background: hex(c.hex) }}
                    title={c.label}
                    aria-label={`${c.label} frame`}
                    onClick={() => set({ color: c.hex })}
                  />
                ))}
              </div>
            </div>
            <div className="wd-row">
              <span className="wd-label">Thickness</span>
              <div className="wd-slider">
                <input
                  type="range"
                  min={FRAME_BAR_MM.min}
                  max={FRAME_BAR_MM.max}
                  step={5}
                  value={spec.barMm}
                  aria-label="Frame thickness"
                  onChange={(e) => set({ barMm: Number(e.target.value) })}
                />
                <span className="wd-value">{(spec.barMm / 10).toFixed(1)}cm</span>
              </div>
            </div>
            <div className="wd-row">
              <span className="wd-label">Mat</span>
              <label className="switch" title={matKey === 'none' ? 'No mat' : 'With mat'}>
                <input
                  type="checkbox"
                  checked={matKey !== 'none'}
                  onChange={(e) => onMat(e.target.checked ? 'auto' : 'none')}
                />
                <span className="knob" aria-hidden="true" />
              </label>
              {matKey !== 'none' && (
                <div className="swatches" role="group" aria-label="Mat color">
                  {MAT_SWATCHES.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`swatch${key === 'auto' ? ' auto' : ''}${matKey === key ? ' active' : ''}`}
                      style={{ background: hex(key === 'auto' ? autoMatColor : MATS[key].color!) }}
                      title={MATS[key].label}
                      aria-label={`${MATS[key].label} mat`}
                      onClick={() => onMat(key)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="wd-note">Stretched canvas — the work hangs bare, gallery-style.</p>
        )}
      </div>

      <div className="wd-group">
        <div className="wd-title"><span>Display</span></div>
        <div className="wd-row">
          <span className="wd-label">Hanging</span>
          <div className="chips">
            {Object.entries(HANGINGS).map(([key, def]) => (
              <button
                key={key}
                type="button"
                className={`chip chip-visual${key === hangingKey ? ' active' : ''}`}
                onClick={() => onHanging(key)}
              >
                <HangingIcon hangingKey={key} />
                {def.label}
              </button>
            ))}
          </div>
        </div>
        <div className="wd-row">
          <span className="wd-label">Caption</span>
          <div className="chips">
            {Object.entries(CAPTIONS).map(([key, def]) => (
              <button
                key={key}
                type="button"
                className={`chip chip-visual${key === captionKey ? ' active' : ''}`}
                onClick={() => onCaption(key)}
              >
                <CaptionIcon captionKey={key} />
                {def.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
