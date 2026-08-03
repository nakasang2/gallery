'use client'
// A countdown for the email-sending buttons (magic link, resend confirmation,
// reset request). Supabase rate-limits those to one request every ~30–60s; showing
// a live countdown stops the user from hammering the button into a rate-limit error.
import { useEffect, useRef, useState } from 'react'

export function useCooldown(): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])

  const start = (seconds: number) => {
    setLeft(seconds)
    if (timer.current) clearInterval(timer.current)
    timer.current = setInterval(() => {
      setLeft((n) => {
        if (n <= 1) {
          if (timer.current) clearInterval(timer.current)
          return 0
        }
        return n - 1
      })
    }, 1000)
  }

  return [left, start]
}
