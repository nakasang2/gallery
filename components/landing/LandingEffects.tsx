'use client'
// LPのクライアント演出(プロトタイプ src/landing.js から移植)
// - ナビのスクロール背景 / .reveal のふわっと表示
// - ヒーローの浮遊額装(生成アート) + マウス視差
// - デモセクションのミニ額装
import { useEffect } from 'react'
import { ARTWORKS, renderArtworkCanvas } from '@/lib/artworks'

// ヒーローの壁に掛ける作品。少数を大きく、意図的に配置して「壁」に見せる。
// [作品index, 左%, 上%, 幅px, 奥行き(視差の強さ)]
// 生成感の強い幾何スタイルは避け、絵画的な作品を選ぶ(作品は後から差し替え可)
const WALL: [number, number, number, number, number][] = [
  [0, 54, 22, 296, 1.0], // 夜明けの波 — 主役
  [5, 82, 9, 178, 1.7], // 空の重さ
  [9, 79, 48, 200, 2.0], // 遠雷
]

export default function LandingEffects() {
  useEffect(() => {
    const cleanups: (() => void)[] = []

    const nav = document.getElementById('nav')
    const floatsRoot = document.getElementById('hero-floats')
    // 3D廊下より後のセクション用: 視差 / 順次点灯 / ズーム
    const parallaxEls = Array.from(document.querySelectorAll<HTMLElement>('[data-parallax]'))
    const flowLis = Array.from(document.querySelectorAll<HTMLElement>('.flow-steps li'))
    const closingTitle = document.querySelector<HTMLElement>('.closing-title')

    /* ---- スクロール: ナビ背景 + セクション別の連動演出 ---- */
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let scrollRaf: number | null = null
    const applyScroll = () => {
      scrollRaf = null
      nav?.classList.toggle('scrolled', window.scrollY > 40)
      if (prefersReduced) return
      const vh = window.innerHeight

      // 3D非対応時のみ、CSSの額装壁を軽く押し込む
      const hasCanvas = !!document.querySelector('.hero-canvas canvas')
      if (!hasCanvas && floatsRoot) {
        const p = Math.min(1, Math.max(0, window.scrollY / (vh * 0.9)))
        floatsRoot.style.transform = `rotateY(${-8 + p * 3}deg) scale(${1 + p * 0.18}) translateY(${p * -32}px)`
        floatsRoot.style.opacity = String(1 - p * 0.92)
      }

      // 視差: 要素ごとに異なる速度で上下へ(奥行き)
      for (const el of parallaxEls) {
        const r = el.getBoundingClientRect()
        const prog = (r.top + r.height / 2 - vh / 2) / vh
        const f = parseFloat(el.dataset.parallax || '0')
        el.style.transform = `translate3d(0, ${(-prog * f).toFixed(1)}px, 0)`
      }

      // How it works: 画面中央に最も近いステップだけを点灯(スクロールで順に移る)
      if (flowLis.length) {
        let nearest = -1
        let best = Infinity
        flowLis.forEach((li, i) => {
          const r = li.getBoundingClientRect()
          const d = Math.abs(r.top + r.height / 2 - vh / 2)
          if (d < best) {
            best = d
            nearest = i
          }
        })
        // セクションが画面内にあるときだけ点灯(通過後は消灯)
        const on = best < vh * 0.45
        flowLis.forEach((li, i) => li.classList.toggle('active', on && i === nearest))
      }

      // Closing: セクション接近でタイトルをズームイン
      if (closingTitle) {
        const r = closingTitle.getBoundingClientRect()
        const p = Math.min(1, Math.max(0, 1 - (r.top - vh * 0.2) / (vh * 0.7)))
        closingTitle.style.transform = `scale(${(0.93 + p * 0.07).toFixed(3)})`
      }
    }
    const onScroll = () => {
      if (!scrollRaf) scrollRaf = requestAnimationFrame(applyScroll)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    applyScroll()
    cleanups.push(() => {
      window.removeEventListener('scroll', onScroll)
      if (scrollRaf) cancelAnimationFrame(scrollRaf)
    })

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
    cleanups.push(() => io.disconnect())

    /* ---- ヒーロー: ギャラリーの壁(美術館グレードの額装) ---- */
    // モバイル(3D非表示)は主役1点を中央に大きく置き、ヒーローの"空き"を埋める。
    // デスクトップは複数を壁に配置して奥行きを出す。
    const isMobile = window.matchMedia('(max-width: 900px)').matches
    const layout: [number, number, number, number, number][] = isMobile
      ? [[0, 50, 20, Math.min(300, Math.round(window.innerWidth * 0.72)), 1.0]]
      : WALL
    const parallaxItems: { el: HTMLDivElement; depth: number }[] = []
    if (floatsRoot && floatsRoot.childElementCount === 0) {
      layout.forEach(([idx, left, top, width, depth], i) => {
        const art = ARTWORKS[idx]
        const el = document.createElement('div')
        el.className = 'artwork'
        el.style.left = left + '%'
        el.style.top = top + '%'
        // モバイルは中央寄せ(transformは視差に使わないので占有してよい)
        if (isMobile) el.style.transform = 'translateX(-50%)'
        // 入場(card-in: opacity/margin-top)を順にずらし、その後 floaty を無限ループ。
        // 視差は transform を占有するため、両アニメは opacity / margin-top で衝突を避ける。
        const inDelay = 0.4 + i * 0.14
        const floatDur = 9 + depth * 2
        el.style.animation =
          `card-in 1.1s cubic-bezier(0.22, 1, 0.36, 1) ${inDelay}s both,` +
          ` floaty ${floatDur}s ease-in-out ${inDelay + 1.0}s infinite`

        const spot = document.createElement('div')
        spot.className = 'artwork-spot'
        const frame = document.createElement('div')
        frame.className = 'artwork-frame'
        const mat = document.createElement('div')
        mat.className = 'artwork-mat'
        // 高解像度で描いて縮小 = くっきり(生成感を減らす)
        const c = renderArtworkCanvas(art, Math.round(width * 2.2))
        c.style.width = width + 'px'
        c.style.height = 'auto'
        mat.appendChild(c)
        const glass = document.createElement('div')
        glass.className = 'artwork-glass'
        frame.appendChild(mat)
        frame.appendChild(glass)
        el.appendChild(spot)
        el.appendChild(frame)
        floatsRoot.appendChild(el)
        parallaxItems.push({ el, depth })
      })

      // マウスに合わせた繊細な視差(壁の上の物体として動かす)
      let mx = 0
      let my = 0
      let raf: number | null = null
      const applyParallax = () => {
        raf = null
        for (const { el, depth } of parallaxItems) {
          const x = -mx * depth * 9
          const y = -my * depth * 7
          el.style.transform = `translate(${x}px, ${y}px)`
        }
      }
      const onPointerMove = (e: PointerEvent) => {
        mx = (e.clientX / window.innerWidth - 0.5) * 2
        my = (e.clientY / window.innerHeight - 0.5) * 2
        if (!raf) raf = requestAnimationFrame(applyParallax)
      }
      // モバイルはマウス視差なし(中央寄せの transform を保つ)
      if (!isMobile) window.addEventListener('pointermove', onPointerMove)
      cleanups.push(() => {
        window.removeEventListener('pointermove', onPointerMove)
        if (raf) cancelAnimationFrame(raf)
        floatsRoot.replaceChildren()
      })
    }

    /* ---- デモセクションのミニ額装(ヒーローと同じ額装システム) ---- */
    const demoArt = document.getElementById('demo-art')
    if (demoArt && demoArt.childElementCount === 0) {
      for (const idx of [4, 7, 9]) {
        const frame = document.createElement('div')
        frame.className = 'mini-frame'
        const mat = document.createElement('div')
        mat.className = 'mini-mat'
        const c = renderArtworkCanvas(ARTWORKS[idx], 260)
        c.style.width = '118px'
        c.style.height = 'auto'
        mat.appendChild(c)
        const glass = document.createElement('div')
        glass.className = 'mini-glass'
        frame.appendChild(mat)
        frame.appendChild(glass)
        demoArt.appendChild(frame)
      }
      cleanups.push(() => demoArt.replaceChildren())
    }

    return () => cleanups.forEach((fn) => fn())
  }, [])

  return null
}
