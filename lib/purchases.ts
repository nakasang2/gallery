// Real entitlement ownership (REQUIREMENTS.md §11.x) — the read side of the
// `purchases` ledger (migration 0016). There is no write path here on purpose:
// a real purchase is only ever recorded server-side (the Stripe webhook), so
// until someone actually buys, this resolves to the free tier: no owned themes/
// layouts, Design Tools and Video Pass locked.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface OwnedIds {
  themeIds: string[]
  layoutIds: string[]
  /** ③ Design Tools bought (buy-once) */
  designTools: boolean
  /** ① Video Pass active (subscription) */
  videoPass: boolean
}

const EMPTY_OWNED: OwnedIds = { themeIds: [], layoutIds: [], designTools: false, videoPass: false }

export function usePurchasedIds(userId: string | null): OwnedIds {
  const [owned, setOwned] = useState<OwnedIds>(EMPTY_OWNED)

  useEffect(() => {
    if (!supabase || !userId) {
      setOwned(EMPTY_OWNED)
      return
    }
    let alive = true
    supabase
      .from('purchases')
      .select('kind, item_key')
      .eq('user_id', userId)
      .then(({ data, error }) => {
        // 0016 not applied, or offline — fail closed to the free tier (paid axes
        // stay locked). Nobody has purchases until Stripe is live, so this is the
        // correct free base; once live, a transient error briefly locking a paid
        // feature is the safe default.
        if (!alive || error || !data) return
        const rows = data as { kind: string; item_key: string }[]
        setOwned({
          themeIds: rows.filter((r) => r.kind === 'theme').map((r) => r.item_key),
          layoutIds: rows.filter((r) => r.kind === 'layout').map((r) => r.item_key),
          designTools: rows.some((r) => r.kind === 'design_tools'),
          videoPass: rows.some((r) => r.kind === 'video_pass'),
        })
      })
    return () => {
      alive = false
    }
  }, [userId])

  return owned
}
