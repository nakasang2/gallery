import { ARTWORKS, renderArtworkCanvas } from './artworks.js'

/* ---- ナビ: スクロールで背景を付ける ---- */
const nav = document.getElementById('nav')
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 40)
window.addEventListener('scroll', onScroll, { passive: true })
onScroll()

/* ---- スクロールで要素をふわっと表示 ---- */
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('visible')
        io.unobserve(e.target)
      }
    }
  },
  { threshold: 0.15 }
)
document.querySelectorAll('.reveal').forEach((el) => io.observe(el))

/* ---- ヒーロー: 浮遊する額装作品 ---- */
// [作品index, 左%, 上%, 幅px, 奥行き(視差の強さ), 遅延s]
const FLOATS = [
  [0, 68, 9, 200, 1.0, 0],
  [1, 86, 35, 150, 1.7, 1.2],
  [3, 67, 57, 135, 1.4, 2.1],
  [8, 80, 76, 120, 2.1, 0.6],
  [2, 93, 5, 110, 1.3, 1.7],
]

const floatsRoot = document.getElementById('hero-floats')
const parallaxItems = []

if (floatsRoot) {
  for (const [idx, left, top, width, depth, delay] of FLOATS) {
    const art = ARTWORKS[idx]
    const card = document.createElement('div')
    card.className = 'float-card'
    card.style.left = left + '%'
    card.style.top = top + '%'
    card.style.animationDelay = delay + 's'
    card.style.animationDuration = 8 + depth * 2 + 's'
    const c = renderArtworkCanvas(art, Math.round(width * 1.6))
    c.style.width = width + 'px'
    c.style.height = 'auto'
    card.appendChild(c)
    floatsRoot.appendChild(card)
    parallaxItems.push({ el: card, depth })
  }

  // マウスに合わせた視差
  let mx = 0
  let my = 0
  let raf = null
  window.addEventListener('pointermove', (e) => {
    mx = (e.clientX / window.innerWidth - 0.5) * 2
    my = (e.clientY / window.innerHeight - 0.5) * 2
    if (!raf) raf = requestAnimationFrame(applyParallax)
  })
  function applyParallax() {
    raf = null
    for (const { el, depth } of parallaxItems) {
      const x = -mx * depth * 14
      const y = -my * depth * 10
      const rx = my * depth * 2.2
      const ry = -mx * depth * 2.8
      el.style.transform = `translate(${x}px, ${y}px) rotateX(${rx}deg) rotateY(${ry}deg)`
    }
  }
}

/* ---- デモセクションのミニ額装 ---- */
const demoArt = document.getElementById('demo-art')
if (demoArt) {
  for (const idx of [4, 6, 9]) {
    const frame = document.createElement('div')
    frame.className = 'mini-frame'
    const c = renderArtworkCanvas(ARTWORKS[idx], 220)
    c.style.width = '128px'
    c.style.height = 'auto'
    frame.appendChild(c)
    demoArt.appendChild(frame)
  }
}
