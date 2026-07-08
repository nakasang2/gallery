'use client'
// Virtual joystick (shown via CSS on touch devices only)
import { useEffect, useRef } from 'react'
import { joyState, walkRef } from '@/lib/controller'
import { useGallery } from '@/lib/store'

const JOY_R = 44

export default function Joystick() {
  const rootRef = useRef<HTMLDivElement>(null!)
  const knobRef = useRef<HTMLDivElement>(null!)

  useEffect(() => {
    const el = rootRef.current
    const knob = knobRef.current

    const move = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      let dx = e.clientX - (rect.left + rect.width / 2)
      let dy = e.clientY - (rect.top + rect.height / 2)
      const len = Math.hypot(dx, dy)
      if (len > JOY_R) {
        dx = (dx / len) * JOY_R
        dy = (dy / len) * JOY_R
      }
      joyState.x = dx / JOY_R
      joyState.y = dy / JOY_R
      knob.style.transform = `translate(${dx}px, ${dy}px)`
    }
    const onDown = (e: PointerEvent) => {
      e.preventDefault()
      const g = useGallery.getState()
      g.setTourActive(false)
      g.setFocused(-1)
      walkRef.current?.cancel()
      joyState.active = true
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // Ignore when pointerId is invalid, e.g. for synthetic events
      }
      move(e)
    }
    const onMove = (e: PointerEvent) => {
      if (joyState.active) move(e)
    }
    const end = () => {
      joyState.active = false
      joyState.x = 0
      joyState.y = 0
      knob.style.transform = 'translate(0px, 0px)'
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      end()
    }
  }, [])

  return (
    <div id="joy" className="joy" aria-hidden="true" ref={rootRef}>
      <div className="joy-knob" ref={knobRef} />
    </div>
  )
}
