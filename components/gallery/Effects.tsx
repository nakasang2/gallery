'use client'
// ポストプロセス: AO(接地感)+ 連続ハイトフォグ + 控えめなブルーム + SMAA
// タッチ端末では素のレンダリングに落とす(GalleryScene 側で分岐)
import { EffectComposer, N8AO, Bloom, Vignette, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import type { ThemeDef } from '@/lib/presets'
import HeightFog from './HeightFog'

export default function Effects({ theme }: { theme: ThemeDef }) {
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={1.2} distanceFalloff={2.5} intensity={2.4} quality="medium" />
      {/* 連続ミスト(深度ベース)。床に近いほど濃く、移動してもカクつかない */}
      <HeightFog
        color={theme.mistColor}
        density={theme.mistDensity}
        falloff={theme.mistFalloff}
        floor={0}
        intensity={theme.mistLevel}
      />
      <Bloom mipmapBlur intensity={0.22} luminanceThreshold={0.85} luminanceSmoothing={0.1} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {/* 画面周辺をわずかに落として視線を中央へ */}
      <Vignette eskil={false} offset={0.26} darkness={0.52} />
      <SMAA />
    </EffectComposer>
  )
}
