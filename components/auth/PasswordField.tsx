'use client'
// Password input with a show/hide toggle and an optional strength meter. Replaces
// the three near-identical raw <input type="password"> blocks across signin / signup
// / reset. The toggle is a real <button> (labelable, so it does not steal the
// <label> from the input, which is the first labelable descendant).
import { useState } from 'react'
import { useT } from '@/components/I18nProvider'
import { passwordScore, SCORE_LABEL_KEY } from '@/lib/password'

export default function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  required,
  showStrength = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: 'current-password' | 'new-password'
  minLength?: number
  required?: boolean
  showStrength?: boolean
}) {
  const t = useT()
  const [show, setShow] = useState(false)
  const score = showStrength ? passwordScore(value) : 0
  const toggleLabel = t(show ? 'auth.hidePassword' : 'auth.showPassword')

  return (
    <label className="auth-field">
      <span>{label}</span>
      <div className="auth-pw">
        <input
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="auth-pw-toggle"
          aria-pressed={show}
          aria-label={toggleLabel}
          // Keep focus in the input when toggling.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShow((s) => !s)}
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {showStrength && value.length > 0 && (
        <div className="auth-strength" data-score={score}>
          <div className="auth-strength-track" aria-hidden="true">
            <span className="auth-strength-seg" />
            <span className="auth-strength-seg" />
            <span className="auth-strength-seg" />
            <span className="auth-strength-seg" />
          </div>
          <span className="auth-strength-label">
            {t('auth.strengthLabel')}: {t(SCORE_LABEL_KEY[score])}
          </span>
        </div>
      )}
    </label>
  )
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c7 0 10.5 6 10.5 6a17 17 0 0 1-3.3 3.8M6.3 7.8A17 17 0 0 0 1.5 12S5 18 12 18a9.6 9.6 0 0 0 3.4-.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}
