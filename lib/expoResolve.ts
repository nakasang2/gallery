// exhibition slug → username, memoised per request.
//
// Its own module because `lib/seo.ts` is where the other `cache()`d reads live, and
// `seo.ts` imports `roomPlan`, which pulls in the preset/arrangement graph — this
// lookup alone doesn't need any of that. `lib/seo.ts`'s `resolveExpoLobby`/
// `resolveExpoRoom` are the only current callers (both already need the rest of
// `seo.ts` regardless), so the split doesn't currently save a request from loading
// `roomPlan`; it stays worth keeping separate for a future caller that only needs
// the slug→username check (e.g. a custom-domain routing check ahead of rendering).
import { cache } from 'react'
import { fetchUsernameByExpoSlug } from './publish'

/** Memoised so `generateMetadata` and the page body share one lookup — the same reason
 *  `getExhibition` is cached. */
export const getUsernameForExpoSlug = cache(fetchUsernameByExpoSlug)
