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

/** Disposes `resource` one tick after it stops being current, unless a
 *  same-identity remount cancels it first. React Strict Mode simulates an
 *  unmount immediately followed by a remount that reuses the SAME `video`/
 *  `VideoTexture` instance (useMemo isn't re-run) — disposing on that first,
 *  synchronous cleanup would tear down a resource the very next mount is
 *  about to reuse. A real unmount, or `art.src` actually changing to a new
 *  video, is never followed by a same-identity remount, so the deferred
 *  disposal is left to fire (リリース前監査 #7・2026-08-21). */
function useDeferredDispose<T>(resource: T | null, dispose: (r: T) => void) {
  // A ref, not a dependency, so passing a fresh arrow function each render
  // doesn't retrigger the schedule/cancel dance below.
  const disposeRef = useRef(dispose)
  disposeRef.current = dispose
  const pending = useRef<{ resource: T; timer: ReturnType<typeof setTimeout> } | null>(null)
  useEffect(() => {
    if (!resource) return
    if (pending.current?.resource === resource) {
      clearTimeout(pending.current.timer)
      pending.current = null
    }
    return () => {
      const timer = setTimeout(() => {
        disposeRef.current(resource)
        pending.current = null
      }, 0)
      pending.current = { resource, timer }
    }
  }, [resource])
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

  // Register with the playback manager and clean up. React Strict Mode simulates
  // an unmount right after mount reusing the SAME `video`, so this cleanup only
  // does operations that can be reverted (pause, not dispose). The irreversible
  // teardown (freeing the decoder/GPU texture) is handled by useDeferredDispose
  // below, which tells a real replacement/unmount apart from Strict Mode's replay.
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

  useDeferredDispose(video, (v) => {
    v.removeAttribute('src')
    v.load()
  })
  useDeferredDispose(videoTex, (t) => t.dispose())
  useDeferredDispose(posterTex, (t) => t.dispose())
  useDeferredDispose(audio, (a) => a.disconnect())

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
