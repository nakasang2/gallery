'use client'
// "Record a shareable walkthrough": run the guided tour while capturing the
// canvas to a WebM the artist can post to X/Instagram (STRATEGY §4.1-1 growth
// loop). Exposed as a hook so the HUD action cluster (Others → Record) can drive
// it; the recorder still no-ops if the browser can't record (canRecord check).
import { useEffect, useRef, useState } from 'react'
import { useGallery } from '@/lib/store'
import { useExhibitionList } from '@/lib/exhibition'
import { walkRef, canvasRef } from '@/lib/controller'
import { startRecording, downloadClip, canRecord, pickWebmMime, type WalkRecorder } from '@/lib/recorder'
import { showToast } from '@/lib/toast'

// Per-work dwell is 6.2s (see useTour); add lead-in/out and a hard ceiling so a
// stuck tour can never record forever.
const PER_WORK_MS = 6200
const TAIL_MS = 1200
const MAX_MS = 90_000

export function useWalkRecorder() {
  const count = useExhibitionList().length
  const [recording, setRecording] = useState(false)
  const [supported, setSupported] = useState(true)
  const recRef = useRef<WalkRecorder | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Gate on browser capability (MediaRecorder + a WebM mime), knowable at mount.
  // The canvas is created after mount, so its captureStream is re-verified at click.
  useEffect(() => {
    setSupported(pickWebmMime() !== null)
  }, [])

  // Tidy up subscriptions/timers if we unmount mid-recording
  useEffect(() => {
    return () => {
      unsubRef.current?.()
      if (timerRef.current) clearTimeout(timerRef.current)
      recRef.current?.stop()
    }
  }, [])

  function finish() {
    unsubRef.current?.()
    unsubRef.current = null
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    recRef.current?.stop()
    recRef.current = null
    setRecording(false)
  }

  function start() {
    const canvas = canvasRef.current
    if (!canvas || !canRecord(canvas)) {
      showToast('Recording isn’t supported in this browser — try Chrome or Edge.')
      setSupported(false)
      return
    }
    const rec = startRecording(canvas, (blob) => {
      if (blob.size > 0) downloadClip(blob)
      else showToast('The recording came out empty — please try again.')
    })
    if (!rec) {
      showToast('Recording isn’t supported in this browser — try Chrome or Edge.')
      setSupported(false)
      return
    }
    recRef.current = rec
    setRecording(true)

    // Start the walk from the entrance, then run the guided tour
    walkRef.current?.resetToEntry()
    const g = useGallery.getState()
    g.setSettingsOpen(false)
    g.setGuestbookOpen(false)
    g.setTourActive(true)

    // Stop when the tour ends on its own (tourActive flips back to false)
    unsubRef.current = useGallery.subscribe((s, prev) => {
      if (prev.tourActive && !s.tourActive) finish()
    })

    // Safety ceiling: never record past the expected tour length (+ tail), capped
    const expected = Math.min(count * PER_WORK_MS + TAIL_MS, MAX_MS)
    timerRef.current = setTimeout(finish, expected)
  }

  return {
    /** false when the browser can't record or there are no works to tour */
    available: supported && count > 0,
    recording,
    toggle: () => (recording ? finish() : start()),
  }
}
