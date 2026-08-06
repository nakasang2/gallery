'use client'
// Visitor-behaviour probe for the 3D gallery. Renders nothing.
//
// WHERE THIS LIVES MATTERS: it is mounted by VisitorGallery, OUTSIDE the
// dynamic() import of GalleryApp. Mounted inside GalleryApp it could not observe
// the loading screen — and "left before the door opened" is one of the things we
// most need to see (docs/ANALYTICS.md §1).
//
// Nearly everything is read from the zustand store with a single subscription
// (lib/store): focus, tour, and every panel already live there, so the 3D
// components need no instrumentation at all. The two exceptions are the camera
// pose (deliberately off React's render path — sampled here on a timer) and the
// visitor's own actions (like/share/guestbook), which set flags in lib/analytics.
import { useEffect } from 'react'
import { useGallery } from '@/lib/store'
import { camPose } from '@/lib/controller'
import { focusIntent, resetSessionFlags, sessionFlags, track } from '@/lib/analytics'

/** How often the camera pose is sampled for the movement heatmap. */
const POSE_SAMPLE_MS = 1000
/** Cap on pose samples per visit — a long session must not become a flood. */
const MAX_POSE_SAMPLES = 120
/** No movement for this long, with no work open, reads as "lost". */
const STUCK_MS = 30_000

export default function AnalyticsProbe({
  galleryId,
  embed,
  works,
}: {
  galleryId: string
  embed: boolean
  works: number
}) {
  useEffect(() => {
    resetSessionFlags()

    const t0 = Date.now()
    const common = { gallery_id: galleryId, embed, works }

    // ---- Visible-time accounting -------------------------------------------
    // The 3D canvas stops rendering when the tab is not in front, but timers keep
    // running. Counting hidden time as dwell would report that a visitor who
    // wandered off mid-session studied one painting for an hour (AGENTS.md 5.6 is
    // the same trap seen from the measuring side). Everything below is measured
    // in VISIBLE milliseconds.
    let hiddenSince: number | null = document.hidden ? Date.now() : null
    let hiddenTotal = 0
    const hiddenMsNow = () => hiddenTotal + (hiddenSince === null ? 0 : Date.now() - hiddenSince)
    const visibleMsSince = (from: number, hiddenAt: number) =>
      Math.max(0, Date.now() - from - (hiddenMsNow() - hiddenAt))

    // ---- Focus / dwell ------------------------------------------------------
    let focusId: string | null = null
    let focusStart = 0
    let focusHiddenAt = 0
    let focusVia = 'unknown'

    const closeDwell = () => {
      if (!focusId) return
      track('gallery_work_dwell', {
        ...common,
        artwork_id: focusId,
        via: focusVia,
        ms: visibleMsSince(focusStart, focusHiddenAt),
        hidden_ms: hiddenMsNow() - focusHiddenAt,
      })
      focusId = null
    }

    // ---- Movement -----------------------------------------------------------
    let firstMoveSent = false
    let poseSamples = 0
    let lastX = camPose.x
    let lastZ = camPose.z
    let lastMovedAt = Date.now()
    let stuckSent = false

    const poseTimer = setInterval(() => {
      if (document.hidden) return
      const dx = camPose.x - lastX
      const dz = camPose.z - lastZ
      const moved = Math.hypot(dx, dz)

      if (moved > 0.15) {
        lastMovedAt = Date.now()
        stuckSent = false
        if (!firstMoveSent) {
          firstMoveSent = true
          track('gallery_move_first', { ...common, ms: visibleMsSince(t0, 0) })
        }
        if (poseSamples < MAX_POSE_SAMPLES) {
          poseSamples++
          // Rounded to 10cm: the heatmap needs where people stood, not a replay,
          // and coarse buckets keep GA4's cardinality from exploding.
          track('gallery_move_sample', {
            ...common,
            x: Math.round(camPose.x * 10) / 10,
            z: Math.round(camPose.z * 10) / 10,
            yaw: Math.round(camPose.yaw * 100) / 100,
          })
        }
      } else if (
        !stuckSent &&
        firstMoveSent &&
        focusId === null &&
        Date.now() - lastMovedAt > STUCK_MS
      ) {
        stuckSent = true
        track('gallery_stuck', { ...common, ms: Date.now() - lastMovedAt })
      }
      lastX = camPose.x
      lastZ = camPose.z
    }, POSE_SAMPLE_MS)

    // ---- Store subscription: focus, tour, panels ----------------------------
    let tourStart = 0
    let tourFrom = -1

    const unsub = useGallery.subscribe((s, prev) => {
      // Focus changed → close the previous dwell, open the next
      if (s.focusedIndex !== prev.focusedIndex) {
        closeDwell()
        if (s.focusedIndex >= 0) {
          const art = (s.visitor?.artworks ?? [])[s.focusedIndex]
          focusId = art?.id ?? `index_${s.focusedIndex}`
          focusStart = Date.now()
          focusHiddenAt = hiddenMsNow()
          // The tour drives focus itself, so it wins over whatever a call site
          // last set — otherwise a stale 'click' would be attributed to every
          // work the tour walks to afterwards.
          focusVia = s.tourActive ? 'tour' : focusIntent.via
          focusIntent.via = 'unknown'

          const depth = s.focusedIndex + 1
          if (depth > sessionFlags.maxDepth) sessionFlags.maxDepth = depth
          const firstTime = !sessionFlags.worksFocused.has(focusId)
          sessionFlags.worksFocused.add(focusId)
          track('gallery_work_focus', {
            ...common,
            artwork_id: focusId,
            index: s.focusedIndex,
            depth,
            via: focusVia,
            first_time: firstTime,
          })
        }
      }

      if (s.tourActive !== prev.tourActive) {
        if (s.tourActive) {
          tourStart = Date.now()
          tourFrom = s.focusedIndex
          track('gallery_tour_start', { ...common, recording: s.tourRecording, from_index: tourFrom })
        } else {
          track('gallery_tour_end', {
            ...common,
            ms: visibleMsSince(tourStart, 0),
            at_index: prev.focusedIndex,
            // The tour clears itself after the last work; anything earlier is
            // the visitor taking over (walking, a tap, the stop button).
            completed: prev.focusedIndex >= works - 1,
          })
        }
      }

      if (s.guestbookOpen && !prev.guestbookOpen) track('gallery_guestbook_open', common)
      if (s.infoOpen && !prev.infoOpen) track('gallery_info_open', common)
    })

    // ---- Visibility + exit --------------------------------------------------
    // A backgrounded mobile tab can be killed without ever firing pagehide, so
    // the first `hidden` has to count as an ending. But phones background tabs
    // constantly, and summarising once at the first app-switch would truncate
    // most visits — so coming back re-arms the summary and the next one carries a
    // higher `seq` with cumulative totals. Analysis takes the highest seq per
    // session; the earlier ones are prefixes of it, not extra visits.
    let summarySent = false
    let summarySeq = 0

    function sendSummary(reason: string) {
      if (summarySent) return
      summarySent = true
      closeDwell()
      track('gallery_session_summary', {
        ...common,
        reason,
        seq: ++summarySeq,
        // False here is the headline number: they arrived and left without the
        // room ever opening (slow assets, no WebGL, a lost context).
        room_opened: sessionFlags.roomOpened,
        total_ms: visibleMsSince(t0, 0),
        hidden_ms: hiddenMsNow(),
        works_focused: sessionFlags.worksFocused.size,
        max_depth: sessionFlags.maxDepth,
        reached_end: works > 0 && sessionFlags.maxDepth >= works,
        did_like: sessionFlags.liked,
        did_share: sessionFlags.shared,
        did_sign: sessionFlags.signed,
      })
    }

    const onVisibility = () => {
      if (document.hidden) {
        hiddenSince = Date.now()
        sendSummary('hidden')
      } else if (hiddenSince !== null) {
        hiddenTotal += Date.now() - hiddenSince
        hiddenSince = null
        summarySent = false // back in the room — the visit is still running
        // The summary closed the open dwell on the way out. If the same work is
        // still on screen, start a fresh dwell for it rather than letting the
        // rest of the viewing go unmeasured.
        const s = useGallery.getState()
        if (focusId === null && s.focusedIndex >= 0) {
          const art = (s.visitor?.artworks ?? [])[s.focusedIndex]
          focusId = art?.id ?? `index_${s.focusedIndex}`
          focusStart = Date.now()
          focusHiddenAt = hiddenMsNow()
        }
      }
    }
    const onPageHide = () => sendSummary('pagehide')

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      clearInterval(poseTimer)
      unsub()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      // Client-side navigation away from the room (the HUD's back links) unmounts
      // us without either event firing.
      sendSummary('unmount')
    }
  }, [galleryId, embed, works])

  return null
}
