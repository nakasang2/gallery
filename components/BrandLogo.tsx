// The brand mark, drawn inline rather than loaded as an image.
//
// Inline for the same reason as before: every place this used to be plain text (or the
// previous logo) had a colour rule on it already — --ink on paper, --muted in the gallery
// HUD, --gold on hover, the page's own ink on the dark loading screen. `currentColor` lets
// all of that keep working, and an <img> could not inherit page colour the same way.
//
// Six paths, one per bar. Geometry is the artwork's own (170x170; ink spans roughly
// x 21..149, y 17.5..152.5 — nearly square, not the wide lockup the previous mark used).
// public/brand/xibit360-mark.svg is the source these paths were taken from — regenerate
// from there, do not hand-edit.
//
// Decorative by default (aria-hidden): every call site wraps this in a link or heading
// that already carries its own aria-label="XIBIT360". Labelling the SVG too risked a
// nested "XIBIT360, image" stop inside "XIBIT360, link" on screen readers that don't
// collapse it. If a future spot needs to use this with no labelled ancestor, pass an
// explicit `label` rather than re-adding a default here.

const BARS = [
  'M34 152.5L28 151V23.8838L21 25.5V20.5L34 17.5V152.5Z',
  'M52 132.5L46 131V43.8838L39 45.5V40.5L52 37.5V132.5Z',
  'M70 112.5L64 111V63.8838L57 65.5V60.5L70 57.5V112.5Z',
  'M100 112.5L106 111V63.8838L113 65.5V60.5L100 57.5V112.5Z',
  'M118 132.5L124 131V43.8838L131 45.5V40.5L118 37.5V132.5Z',
  'M136 152.5L142 151V23.8838L149 25.5V20.5L136 17.5V152.5Z',
]

type Props = {
  className?: string
  /** Only pass this if the mark is used with no labelled ancestor. */
  label?: string
  /** Loading-screen use: each bar breathes independently. CSS-only (app/gallery.css
   *  .brand-logo-bar rules); this just adds the hook classes and per-bar delay. */
  animate?: boolean
}

export default function BrandLogo({ className, label, animate }: Props) {
  return (
    <svg
      className={className}
      viewBox="0 0 170 170"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      {BARS.map((d, i) => (
        <path
          key={i}
          d={d}
          className={animate ? 'brand-logo-bar' : undefined}
          style={animate ? { animationDelay: `${i * 0.12}s` } : undefined}
        />
      ))}
    </svg>
  )
}
