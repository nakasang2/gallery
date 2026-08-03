// Password-strength hint for the sign-up / reset meter. This is UX guidance only —
// the real gate is the 8-character minimum enforced in the pages. Deliberately
// dependency-free and simple: length is the dominant factor, character variety
// nudges it up. Returns 0..4, mapped to a label key below.
export type PasswordScore = 0 | 1 | 2 | 3 | 4

export function passwordScore(pw: string): PasswordScore {
  if (!pw) return 0
  let variety = 0
  if (/[a-z]/.test(pw)) variety++
  if (/[A-Z]/.test(pw)) variety++
  if (/\d/.test(pw)) variety++
  if (/[^A-Za-z0-9]/.test(pw)) variety++

  let s = 0
  if (pw.length >= 8) s++
  if (pw.length >= 12) s++
  if (variety >= 2) s++
  if (variety >= 3 && pw.length >= 10) s++
  // Below the minimum can never read as more than "weak", whatever the variety.
  if (pw.length < 8) s = Math.min(s, 1)
  return Math.min(s, 4) as PasswordScore
}

// Index by score. 0/1 → weak, 2 → fair, 3 → good, 4 → strong.
export const SCORE_LABEL_KEY = [
  'auth.strengthWeak',
  'auth.strengthWeak',
  'auth.strengthFair',
  'auth.strengthGood',
  'auth.strengthStrong',
] as const
