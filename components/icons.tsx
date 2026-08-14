// Small inline icon set standing in for emoji glyphs (🔒, 🎬) — renders identically
// across every platform/font and inherits colour via currentColor, unlike emoji.

export function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </svg>
  )
}

// 三本線。狭い幅でダッシュボード上部の行き先をひとつに畳むボタン用（app/me/page.tsx）
export function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  )
}

export function VideoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" className={className}>
      <rect x="2.5" y="4" width="19" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 8.5v7l6-3.5-6-3.5Z" fill="currentColor" />
    </svg>
  )
}

export function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  )
}

// Doorway glyph — the "go to another room" action in the gallery HUD menu
// (opens the room-picker modal, RoomPickerModal.tsx).
export function DoorIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="3" width="12" height="18" rx="1" />
      <path d="M9 12h.01" />
      <path d="M17 8l3-1v10l-3-1" />
    </svg>
  )
}

export function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  )
}

export function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </svg>
  )
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

// Two opposing arrows — the "this room can switch mode" cue next to RoomExpoBadge's
// label (通常展示 ⇄ 合同展示).
export function SwitchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8h13" />
      <path d="M13 4l4 4-4 4" />
      <path d="M20 16H7" />
      <path d="M11 20l-4-4 4-4" />
    </svg>
  )
}

export function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 10a6 6 0 1 0-12 0c0 4-1.5 5.5-1.5 5.5h15S18 14 18 10Z" />
      <path d="M10.5 19a1.8 1.8 0 0 0 3 0" />
    </svg>
  )
}

// トリミング位置(app/me/page.tsx)。額縁を表す枠の中で、実際に見える範囲(塗り)が
// 上/中央/下または左/中央/右のどこに寄っているかを図にする — デザインツールの
// クロップ・アンカー風（ユーザー指示 2026-08-14: チップ/ドットではなくアイコンで）
const CROP_ANCHOR_RECT: Record<'top' | 'bottom' | 'center-v' | 'left' | 'right' | 'center-h', string> = {
  top: '5 5 14 6',
  'center-v': '5 9 14 6',
  bottom: '5 13 14 6',
  left: '5 5 6 14',
  'center-h': '9 5 6 14',
  right: '13 5 6 14',
}
export function CropAnchorIcon({
  dir,
  className,
}: {
  dir: 'top' | 'bottom' | 'center-v' | 'left' | 'right' | 'center-h'
  className?: string
}) {
  const [x, y, w, h] = CROP_ANCHOR_RECT[dir].split(' ')
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.4" />
      <rect x={x} y={y} width={w} height={h} rx="1" fill="currentColor" />
    </svg>
  )
}
