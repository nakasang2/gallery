// Tiny non-blocking toast for the immersive 3D surfaces. A native alert() tears
// the viewer out of a fullscreen walk, so errors and limit notices that happen
// while someone is in the room go through here instead. Destructive confirms
// (which need a hard yes/no) still use window.confirm on purpose.
import { useEffect, useState } from 'react'

type Listener = (msg: string | null) => void

let current: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<Listener>()

/** Show a transient message. Callable from anywhere (including non-React store code). */
export function showToast(msg: string): void {
  current = msg
  listeners.forEach((l) => l(current))
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    current = null
    listeners.forEach((l) => l(null))
    timer = null
  }, 4600)
}

/** Subscribe a component to the current toast message (null = nothing showing). */
export function useToast(): string | null {
  const [msg, setMsg] = useState<string | null>(current)
  useEffect(() => {
    listeners.add(setMsg)
    return () => {
      listeners.delete(setMsg)
    }
  }, [])
  return msg
}
