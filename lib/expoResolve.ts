// subdomain → username, memoised per request.
//
// Its own module because `lib/seo.ts` is where the other `cache()`d reads live, and
// importing it from the subdomain routes would be fine — but `seo.ts` imports
// `roomPlan`, which pulls in the preset/arrangement graph, and the resolve step runs
// before we know whether there is anything to render. Keeping it separate means a
// request for an unknown host does the one lookup and stops.
import { cache } from 'react'
import { fetchUsernameBySubdomain } from './publish'

/** Memoised so `generateMetadata` and the page body share one lookup — the same reason
 *  `getExhibition` is cached. */
export const getUsernameForSubdomain = cache(fetchUsernameBySubdomain)
