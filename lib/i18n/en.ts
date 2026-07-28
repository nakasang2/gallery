// The source of truth for every user-visible string. English is authoritative:
// other locales are typed against this shape, so a missing key is a build error
// rather than a blank button someone notices in production.
//
// Keys are grouped by surface, not by page, because the same string often
// appears in more than one place (the HUD is on /demo, /@handle and the owner
// preview alike).
//
// `{name}` placeholders are filled by t(); `_one` / `_other` suffixes are picked
// with Intl.PluralRules against the `count` param (see lib/i18n/index).
export const en = {
  common: {
    close: 'Close',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'saving…',
    saved: 'saved',
    retry: 'Try again',
    startFree: 'Start free',
    signIn: 'Sign in',
    dashboard: 'Dashboard',
    language: 'Language',
  },

  hud: {
    tour: 'Tour',
    endTour: 'End tour',
    bgmOn: 'BGM on',
    bgmOff: 'BGM off',
    share: 'Share',
    guestbook: 'Guestbook',
    editSpace: 'Edit space',
    others: 'More actions',
    closeMenu: 'Close menu',
    report: 'Report',
    reportAria: 'Report this gallery',
    record: 'Record',
    recordAria: 'Record a walkthrough',
    stop: 'Stop',
    stopAria: 'Stop recording',
    linkCopied: 'Link copied to clipboard',
    yourSpace: 'Your space',
    livePublished: 'live — saved edits publish instantly',
    privateDraft: 'private draft',
    yourExhibition: 'Your exhibition',
    open: 'Open ↗',
    houseTitle: 'XIBIT360 COLLECTION',
    houseSub: 'A permanent collection — ten works',
  },

  hint: {
    drag: 'Drag',
    dragWhat: 'walk & steer',
    tap: 'Tap',
    tapWhat: 'floor to go · a work to view',
    step: 'next work',
  },

  loading: {
    nowShowing: 'Now showing',
    openingDoors: 'Opening the doors…',
    preparing: 'Preparing the gallery…',
  },

  contextLost: {
    title: 'The room lost its connection to the graphics card.',
    body: 'This can happen when the phone is low on memory or you switch apps.',
    rebuild: 'Rebuild the room',
  },

  guestbook: {
    title: 'Guestbook',
    subtitle: 'Leave a note for {name}.',
    namePlaceholder: 'Name (optional)',
    messagePlaceholder: 'Your impressions…',
    sign: 'Sign the guestbook',
    thanks: 'Thank you!',
    anonymous: 'Anonymous',
    unavailable: 'The guestbook is not available for this gallery.',
    closed: '{name} has closed the guestbook for this exhibition.',
    empty: 'No notes yet — be the first.',
  },

  artwork: {
    forSale: 'Available for purchase ↗',
    readAloud: 'Read aloud',
    stopReading: 'Stop',
    next: 'Next work',
    previous: 'Previous work',
  },

  explore: {
    title: 'Explore',
    intro:
      'Every public gallery on the platform, newest-edited first. Walk in — each room opens in 3D, right in your browser.',
    emptyState: 'No public exhibitions yet — be the first.',
    walkThrough_one: '{count} work · walk through in 3D →',
    walkThrough_other: '{count} works · walk through in 3D →',
    loadMore: 'Load more',
  },

  auth: {
    createAccount: 'Create an account',
    displayName: 'Display name (optional)',
    displayNameHint: 'Shown as the artist name',
    email: 'Email',
    password: 'Password (min {min} characters)',
    confirmPassword: 'Confirm password',
    consent:
      'I agree to the Terms of Service and Privacy Policy, and I am 18 or older.',
    consentRequired: 'Please accept the Terms and Privacy Policy to create an account.',
    passwordTooShort: 'Password must be at least {min} characters.',
    passwordMismatch: 'Passwords do not match.',
    continueWithGoogle: 'Continue with Google',
    haveAccount: 'Already have an account? Sign in',
    checkInbox: 'Check your inbox',
    resend: 'Resend the email',
    backToSignIn: 'Back to sign in',
    notConfigured: 'Cloud features are not configured (Supabase keys required in .env.local).',
  },

  report: {
    title: 'Report a problem',
    whatLabel: 'What are you reporting?',
    whatPlaceholder: '@username/gallery or a URL',
    whyLabel: 'Why? (copyright, harassment, illegal content…)',
    contactLabel: 'Your contact (optional, for follow-up)',
    contactPlaceholder: 'email or handle',
    send: 'Send report',
    thanksTitle: 'Thank you',
    thanksBody:
      'Your report has been received. We review reports and take down content that violates the terms.',
    failed: 'Could not send the report — please try again later.',
    unavailable: 'Reporting is not available (Supabase is not configured).',
  },

  footer: {
    terms: 'Terms',
    privacy: 'Privacy',
    legal: 'Legal',
    guides: 'Guides',
    home: 'Home',
    explore: 'Explore',
  },
} as const

/** Same keys, but values widened from literals to `string` — `as const` above is
 *  what makes the keys exhaustively checkable, and it would otherwise pin every
 *  translation to the exact English text. */
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> }

export type Dictionary = Widen<typeof en>
