// Supabase Auth returns error messages in English only, and the pages used to show
// `error.message` verbatim — so a Japanese or Korean visitor got a raw English
// sentence. This maps the known messages to an i18n key by matching a substring of
// the English text (the only hook we have; Supabase does not localize or code these).
// First match wins, so order the more specific checks first. Anything unrecognized
// falls back to a generic key rather than leaking raw English.
//
// Callers render it with `t(authErrorKey(error.message))`.
export function authErrorKey(message: string | undefined | null): string {
  const m = (message ?? '').toLowerCase()
  if (!m) return 'auth.errGeneric'
  // Rate limiting comes in a few shapes: "For security purposes, you can only
  // request this after 41 seconds", "Email rate limit exceeded", "over_request_rate_limit".
  if (
    m.includes('rate limit') ||
    m.includes('you can only request') ||
    m.includes('for security purposes') ||
    m.includes('too many')
  ) {
    return 'auth.errRateLimited'
  }
  if (m.includes('invalid login credentials')) return 'auth.errInvalidCredentials'
  if (m.includes('email not confirmed') || m.includes('not confirmed')) return 'auth.errEmailNotConfirmed'
  if (
    m.includes('already registered') ||
    m.includes('already been registered') ||
    m.includes('user already exists')
  ) {
    return 'auth.errUserExists'
  }
  if (m.includes('different from the old password') || m.includes('should be different')) {
    return 'auth.errSamePassword'
  }
  if (m.includes('password') && (m.includes('at least') || m.includes('weak') || m.includes('should be'))) {
    return 'auth.errWeakPassword'
  }
  if (
    m.includes('unable to validate email') ||
    m.includes('invalid email') ||
    m.includes('invalid format')
  ) {
    return 'auth.errInvalidEmail'
  }
  // Thrown (not returned) when the browser can't reach Supabase at all.
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('load failed')) {
    return 'auth.errNetwork'
  }
  return 'auth.errGeneric'
}

/** True for the one error that has a recovery path on the sign-in page (resend). */
export function isEmailNotConfirmed(message: string | undefined | null): boolean {
  return authErrorKey(message) === 'auth.errEmailNotConfirmed'
}
