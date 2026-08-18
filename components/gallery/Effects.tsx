'use client'
// Post-processing: AO (grounding) + continuous height fog + subtle bloom + SMAA
// On touch devices we fall back to plain rendering (branched in GalleryScene)
import { EffectComposer, N8AO, Bloom, Vignette, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import type { ThemeDef } from '@/lib/presets'
import HeightFog from './HeightFog'
import { PERF } from '@/lib/perfFlags'

export default function Effects({ theme }: { theme: ThemeDef }) {
  // `EffectComposer` の子は Element しか受け取らないので、条件付きの1枚は
  // 配列に入れて `null` を落としてから渡す（`{cond && <X/>}` は型で弾かれる）。
  const passes = [
    // 診断スイッチ `?perf=noao` で外せる（既定は出す）。全画面を舐める処理で、
    // この種では最も重い部類 ── 効くかどうかは推測せず、切って測るためのもの。
    PERF.ao ? <N8AO key="ao" aoRadius={1.5} distanceFalloff={2.5} intensity={2.6} quality="medium" /> : null,
    /* Continuous mist (depth-based). Thicker near the floor, no stepping as you move */
    <HeightFog
      key="fog"
      color={theme.mistColor}
      density={theme.mistDensity}
      falloff={theme.mistFalloff}
      floor={0}
      intensity={theme.mistLevel}
    />,
    /* threshold 1.0: only true emitters (strips, fixture apertures) bloom —
       at 0.85 a bright floor reflection could blow out into a white wash */
    <Bloom key="bloom" mipmapBlur intensity={0.22} luminanceThreshold={1.0} luminanceSmoothing={0.15} />,
    <ToneMapping key="tone" mode={ToneMappingMode.ACES_FILMIC} />,
    /* Darken the screen edges slightly to draw the eye to the center */
    <Vignette key="vignette" eskil={false} offset={0.26} darkness={0.52} />,
    <SMAA key="smaa" />,
  ].filter((p): p is React.JSX.Element => p !== null)

  return (
    // 4x MSAA on the composer buffer: without it, thin geometry (hanging wires,
    // frame edges) and the floor reflection shimmer/crawl as the camera moves —
    // SMAA alone can't fix subpixel aliasing. Desktop-only (this whole component).
    <EffectComposer multisampling={4}>{passes}</EffectComposer>
  )
}
