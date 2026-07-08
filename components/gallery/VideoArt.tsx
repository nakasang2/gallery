'use client'
// Building blocks for displaying video artworks:
// - useVideoArt: prepares a VideoTexture (poster image until playback starts) and PositionalAudio
// - VideoPlaybackManager: runs the control that plays only the few points near the camera
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { ArtworkData } from '@/lib/artworks'
import { getListener, registerVideo, updateVideoPlayback } from '@/lib/videohub'

const texLoader = new THREE.TextureLoader()

// WebAudio constraint: createMediaElementSource can only be called once per media element.
// Cache per element to survive React Strict Mode's double invocation and component rebuilds
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

  // Spatial audio: louder as you approach, with a sense of direction
  const audio = useMemo(() => {
    if (!video) return null
    const listener = getListener()
    const a = new THREE.PositionalAudio(listener)
    a.setNodeSource(getMediaSource(video, listener.context) as unknown as AudioBufferSourceNode)
    a.setRefDistance(1.7) // full volume at this distance, attenuates farther away
    a.setRolloffFactor(1.6)
    a.setDistanceModel('inverse')
    a.gain.gain.value = 0.0001 // first playback fades in (controlled by videohub)
    return a
  }, [video])

  // Register with the playback manager and clean up
  // Note: React Strict Mode simulates an unmount right after mount, so here we only do
  // operations that can be reverted (no clearing src or dispose, which are irreversible;
  // leave the actual cleanup to the browser's GC and texture version management)
  useEffect(() => {
    if (!video) return
    const onPlaying = () => setPlaying(true)
    video.addEventListener('playing', onPlaying)
    const unregister = registerVideo({ id: art.id, position: worldPos, video, audio })
    return () => {
      unregister()
      video.removeEventListener('playing', onPlaying)
      video.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video])

  if (!isVideo) return { texture: null, audio: null }
  // Show the poster until the first frame arrives (avoids a black panel)
  return { texture: playing ? videoTex : (posterTex ?? videoTex), audio }
}

/** Toggle play/pause based on camera position (every 0.4s) */
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
