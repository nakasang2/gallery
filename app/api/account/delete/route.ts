// POST /api/account/delete — delete the account and every file it owns.
//
// Why this is a route and not just client code (it used to be, in lib/cloud.ts):
// deleting the row invalidates the user, so a *later* request could no longer be
// authenticated — `auth.getUser()` would fail for a user that no longer exists,
// and the R2 cleanup would be impossible to authorize. Doing both halves inside
// one request lets us verify the token while the user is still there, then clean
// up with our own R2 credentials.
//
// Order matters (unchanged from before): the delete_my_account RPC (migration
// 0007) runs FIRST, so a failure — unapplied migration, network — leaves the
// account fully intact and the operation retryable. Only once that has committed
// do we touch storage. A storage failure after that point orphans files (a cost
// concern) but never harms the user, so it is reported without failing the call.
//
// Wiping the whole `{uid}/` prefix also cleans up files the old client-side code
// missed — logos, LP images, audio guides and BGM were never in its path list.
import { NextRequest, NextResponse } from 'next/server'
import { deletePrefix, r2Configured } from '@/lib/r2'
import { authenticate } from '@/lib/apiAuth'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const auth = await authenticate(req)
  if (!auth) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  const { error } = await auth.db.rpc('delete_my_account')
  if (error) {
    console.error('delete_my_account failed', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Point of no return passed — the account is gone either way from here.
  if (!r2Configured) return NextResponse.json({ deleted: true, filesRemoved: 0 })
  try {
    const filesRemoved = await deletePrefix(`${auth.uid}/`)
    return NextResponse.json({ deleted: true, filesRemoved })
  } catch (e) {
    console.warn('storage cleanup after account deletion failed (files orphaned):', e)
    return NextResponse.json({ deleted: true, filesRemoved: 0, cleanupFailed: true })
  }
}
