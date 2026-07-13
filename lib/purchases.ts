// Real theme/layout ownership (REQUIREMENTS.md §11.x) — the read side of the
// `purchases` ledger (migration 0016). There is no write path here on purpose:
// a real purchase is only ever recorded server-side once payment integration
// exists, so until then this always resolves empty and changes no behavior.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface OwnedIds {
  themeIds: string[]
  layoutIds: string[]
}

const EMPTY_OWNED: OwnedIds = { themeIds: [], layoutIds: [] }

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
        if (!alive || error || !data) return // 0016 not applied, or offline — full-access default still applies
        const rows = data as { kind: string; item_key: string }[]
        setOwned({
          themeIds: rows.filter((r) => r.kind === 'theme').map((r) => r.item_key),
          layoutIds: rows.filter((r) => r.kind === 'layout').map((r) => r.item_key),
        })
      })
    return () => {
      alive = false
    }
  }, [userId])

  return owned
}
