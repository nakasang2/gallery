'use client'
// 動画作品の表示部品:
// - useVideoArt: VideoTexture(再生開始まではポスター画像)と PositionalAudio を用意する
// - VideoPlaybackManager: カメラに近い数点だけ再生する制御を回す
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { ArtworkData } from '@/lib/artworks'
import { getListener, registerVideo, updateVideoPlayback } from '@/lib/videohub'

const texLoader = new THREE.TextureLoader()

// WebAudioの制約: 1つのメディア要素に createMediaElementSource は一度しか呼べない。
// React Strict Mode の二重実行やコンポーネントの作り直しに耐えるよう、要素ごとにキャッシュする
const mediaSourceCache = new WeakMap<HTMLVideoElement, MediaElementAudioSourceNode>()

function getMediaSource(video: HTMLVideoElement, ctx: AudioContext): MediaElementAudioSourceNode {
  let node = mediaSourceCache.get(video)
  if (!node) {
    node = ctx.createMediaElementSource(video)
    mediaSourceCache.set(video, node)
  }
  return node
}

export function useVideoArt(art: ArtworkData, worldPos: THREE.Vector3) {
  const isVideo = art.kind === 'video' && !!art.src
  const [playing, setPlaying] = useState(false)

  const video = useMemo(() => {
    if (!isVideo) return null
    const v = document.createElement('video')
    v.src = art.src!
    v.crossOrigin = 'anonymous'
    v.loop = true
    v.muted = true
    v.playsInline = true
    v.preload = 'metadata'
    return v
  }, [isVideo, art.src])

  const videoTex = useMemo(() => {
    if (!video) return null
    const t = new THREE.VideoTexture(video)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [video])

  const posterTex = useMemo(() => {
    if (!isVideo || !art.poster) return null
    const t = texLoader.load(art.poster)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
  }, [isVideo, art.poster])

  // 空間オーディオ: 近づくほど大きく、方向も感じる
  const audio = useMemo(() => {
    if (!video) return null
    const listener = getListener()
    const a = new THREE.PositionalAudio(listener)
    a.setNodeSource(getMediaSource(video, listener.context) as unknown as AudioBufferSourceNode)
    a.setRefDistance(1.7) // この距離で等倍、離れると減衰
    a.setRolloffFactor(1.6)
    a.setDistanceModel('inverse')
    return a
  }, [video])

  // 再生管理への登録と後片付け
  // 注: React Strict Mode はマウント直後に一度アンマウントを疑似実行するため、
  // ここでは「元に戻せる」操作だけを行う(src消去やdisposeは不可逆なのでしない。
  // 実体はブラウザのGCとテクスチャのバージョン管理に任せる)
  useEffect(() => {
    if (!video) return
    const onPlaying = () => setPlaying(true)
    video.addEventListener('playing', onPlaying)
    const unregister = registerVideo({ id: art.id, position: worldPos, video })
    return () => {
      unregister()
      video.removeEventListener('playing', onPlaying)
      video.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video])

  if (!isVideo) return { texture: null, audio: null }
  // 最初のフレームが来るまではポスターを見せる(黒い板を避ける)
  return { texture: playing ? videoTex : (posterTex ?? videoTex), audio }
}

/** カメラ位置に応じた再生/停止の切り替え(0.4秒間隔) */
export function VideoPlaybackManager() {
  const acc = useRef(0)
  useFrame((state, dt) => {
    acc.current += dt
    if (acc.current < 0.4) return
    acc.current = 0
    updateVideoPlayback(state.camera.position)
  })
  return null
}
