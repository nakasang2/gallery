'use client'
// ポストプロセス: AO(接地感)+ 控えめなブルーム + SMAA
// タッチ端末では素のレンダリングに落とす(GalleryScene 側で分岐)
import { EffectComposer, N8AO, Bloom, Vignette, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'

export default function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={1.2} distanceFalloff={2.5} intensity={2.4} quality="medium" />
      <Bloom mipmapBlur intensity={0.22} luminanceThreshold={0.85} luminanceSmoothing={0.1} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {/* 画面周辺をわずかに落として視線を中央へ */}
      <Vignette eskil={false} offset={0.26} darkness={0.52} />
      <SMAA />
    </EffectComposer>
  )
}
