'use client'
// Post-processing: AO (grounding) + continuous height fog + subtle bloom + SMAA
// On touch devices we fall back to plain rendering (branched in GalleryScene)
import { EffectComposer, N8AO, Bloom, Vignette, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import type { ThemeDef } from '@/lib/presets'
import HeightFog from './HeightFog'

export default function Effects({ theme }: { theme: ThemeDef }) {
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={1.2} distanceFalloff={2.5} intensity={2.4} quality="medium" />
      {/* Continuous mist (depth-based). Thicker near the floor, no stepping as you move */}
      <HeightFog
        color={theme.mistColor}
        density={theme.mistDensity}
        falloff={theme.mistFalloff}
        floor={0}
        intensity={theme.mistLevel}
      />
      <Bloom mipmapBlur intensity={0.22} luminanceThreshold={0.85} luminanceSmoothing={0.1} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {/* Darken the screen edges slightly to draw the eye to the center */}
      <Vignette eskil={false} offset={0.26} darkness={0.52} />
      <SMAA />
    </EffectComposer>
  )
}
