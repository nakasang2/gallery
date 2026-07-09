import Link from 'next/link'
import LandingEffects from '@/components/landing/LandingEffects'
import HeroCanvas from '@/components/landing/HeroCanvas'

export default function LandingPage() {
  return (
    <>
      <LandingEffects />

      <nav className="nav" id="nav">
        <Link className="nav-logo" href="/">HAKONIWA</Link>
        <div className="nav-links">
          <a href="#concept">Concept</a>
          <a href="#features">Features</a>
          <a href="#flow">How it works</a>
          <a href="#pricing">Pricing</a>
          <Link href="/signin">Sign in</Link>
        </div>
        <Link className="btn btn-small" href="/demo">Enter demo</Link>
      </nav>

      {/* ============ HERO — immersive entry ============ */}
      <header className="hero" id="hero">
        {/* 3D非対応/モバイル時のフォールバックとしてCSSの額装壁を残す */}
        <div className="hero-floats" id="hero-floats" aria-hidden="true"></div>
        {/* 固定背景の3D美術館(グレードも内包)。ヒーロー〜廊下を通して常駐 */}
        <HeroCanvas />

        {/* 入口のミニマルなクローム(ナビはスクロールで初めて現れる) */}
        <div className="hero-chrome">
          <Link className="hero-mark" href="/">HAKONIWA</Link>
          <Link className="hero-enter" href="/demo">Enter the gallery →</Link>
        </div>

        <div className="hero-lead-wrap">
          <p className="hero-eyebrow">An exhibition of one</p>
          <h1 className="hero-title">Step into your own light.</h1>
          <p className="hero-sub">
            A permanent room for your work — walked, not scrolled.
          </p>
          <Link className="hero-cta" href="/demo">Walk the gallery</Link>
        </div>

        <div className="hero-scroll" aria-hidden="true">Scroll to enter</div>
      </header>

      {/* ============ CORRIDOR — walk the hall; features hang on the 3D walls ============ */}
      {/* 3D対応時はこの区間で背景の廊下をスクロールで進む(パネルは3D側に掲示)。
          非対応/モバイルでは下の縦積みカードにフォールバックする。 */}
      <section className="corridor" id="features" aria-label="Features">
        <div className="corridor-cue" aria-hidden="true">
          <span className="section-eyebrow">Features</span>
          <p>Walk the hall — six things the room can do, hung along the wall.</p>
        </div>
        <div className="corridor-fallback">
          <div className="section-head">
            <p className="section-eyebrow">Features</p>
            <h2 className="section-title">What the room can do.</h2>
          </div>
          <div className="cfeat"><span className="cfeat-no">01</span><div><h3>A solo show in the browser</h3><p>No apps, no plugins. One link opens the gallery, and visitors walk it on desktop or phone.</p></div></div>
          <div className="cfeat"><span className="cfeat-no">02</span><div><h3>Hang works by drag &amp; drop</h3><p>Upload an image and place it on a wall. Height, spacing and sightlines snap to the template.</p></div></div>
          <div className="cfeat"><span className="cfeat-no">03</span><div><h3>Light and stage every piece</h3><p>Spotlights, wall colour and flooring set the mood. Each work gets its own presentation.</p></div></div>
          <div className="cfeat"><span className="cfeat-no">04</span><div><h3>One address, open worldwide</h3><p><code>hakoniwa.app/@you</code> — a permanent URL for your practice, made for any bio or portfolio.</p></div></div>
          <div className="cfeat"><span className="cfeat-no">05</span><div><h3>Captions that carry the story</h3><p>Title, year and statement are mounted beside each work, the way a museum label would be.</p></div></div>
          <div className="cfeat"><span className="cfeat-no">06</span><div><h3>Guestbook &amp; reactions</h3><p>Footprints, notes, quiet appreciation — feedback that behaves like an exhibition, not a comment feed.</p></div></div>
        </div>
      </section>

      {/* ============ MARQUEE ============ */}
      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          <span>Illustration&ensp;·&ensp;Photography&ensp;·&ensp;Painting&ensp;·&ensp;Ink&ensp;·&ensp;Generative&ensp;·&ensp;3DCG&ensp;·&ensp;Collage&ensp;·&ensp;Graphic&ensp;·&ensp;</span>
          <span>Illustration&ensp;·&ensp;Photography&ensp;·&ensp;Painting&ensp;·&ensp;Ink&ensp;·&ensp;Generative&ensp;·&ensp;3DCG&ensp;·&ensp;Collage&ensp;·&ensp;Graphic&ensp;·&ensp;</span>
        </div>
      </div>

      {/* ============ CONCEPT — a moment in the walk ============ */}
      <section className="concept" id="concept">
        <div className="concept-inner">
          <p className="section-eyebrow reveal">Concept</p>
          <h2 className="concept-statement" data-parallax="30">
            An exhibition,<br /><em>not a feed.</em>
          </h2>
          <div className="concept-cols" data-parallax="-14">
            <p>
              The moment a work lands in a grid, it becomes one of a million thumbnails.
              But every piece has an intended order, a distance, a lighting — a silence
              it deserves around it.
            </p>
            <p>
              HAKONIWA builds a private gallery inside the browser. Visitors walk the room,
              stop, lean in, and meet your work in the context you designed. One link opens
              your show to the world.
            </p>
          </div>
          <div className="concept-stats reveal">
            <div className="stat"><b>3 min</b><span>from upload to opening</span></div>
            <div className="stat"><b>Free</b><span>to start, nothing to install</span></div>
            <div className="stat"><b>1 URL</b><span>to invite the world</span></div>
          </div>
        </div>
      </section>

      {/* ============ FLOW ============ */}
      <section className="flow" id="flow">
        <div className="section-head reveal">
          <p className="section-eyebrow">How it works</p>
          <h2 className="section-title">Three steps to opening night.</h2>
        </div>
        <ol className="flow-steps">
          <li className="reveal">
            <span className="flow-no">01</span>
            <h3>Upload your work</h3>
            <p>JPG, PNG or WebP — with a title, year and notes for your collection.</p>
          </li>
          <li className="reveal">
            <span className="flow-no">02</span>
            <h3>Compose the room</h3>
            <p>Pick a template, arrange the walls, tune the light and the route.</p>
          </li>
          <li className="reveal">
            <span className="flow-no">03</span>
            <h3>Publish the URL</h3>
            <p>Press open, send the link, and receive visitors from anywhere.</p>
          </li>
        </ol>
      </section>

      {/* ============ DEMO ============ */}
      <section className="demo reveal" id="demo">
        <div className="demo-card">
          <div className="demo-art" id="demo-art" data-parallax="40" aria-hidden="true"></div>
          <div className="demo-body">
            <p className="section-eyebrow">Demo Exhibition</p>
            <h2 className="section-title">First,<br />take a walk.</h2>
            <p>
              The permanent collection shows ten (fictional) artists.
              Drag to look around, tap the floor to move, and click any work
              to read its label.
            </p>
            <Link className="btn btn-primary" href="/demo">Enter the demo gallery — free</Link>
          </div>
        </div>
      </section>

      {/* ============ PRICING ============ */}
      <section className="pricing" id="pricing">
        <div className="section-head reveal">
          <p className="section-eyebrow">Pricing — concept</p>
          <h2 className="section-title">Plans</h2>
        </div>
        <div className="pricing-grid">
          <div className="price-card reveal">
            <h3>Free</h3>
            <div className="price"><b>¥0</b><span>/ month</span></div>
            <ul>
              <li>One gallery room</li>
              <li>Up to 10 works</li>
              <li>Public URL</li>
              <li>Mobile-ready viewer</li>
            </ul>
            <Link className="btn btn-small price-cta" href="/signup">Start free</Link>
          </div>
          <div className="price-card price-card--pro reveal">
            <div className="price-badge">For Artists</div>
            <h3>Pro</h3>
            <div className="price"><b>¥980</b><span>/ month</span></div>
            <ul>
              <li>Unlimited galleries</li>
              <li>Unlimited works</li>
              <li>Space customisation — walls, floor, light, sound</li>
              <li>Visitor analytics</li>
              <li>Custom domain</li>
            </ul>
          </div>
        </div>
        <p className="pricing-note reveal">HAKONIWA is a prototype. Pricing is part of the product concept — billing is not implemented.</p>
      </section>

      {/* ============ CLOSING — the invitation ============ */}
      <section className="closing" id="closing">
        <div className="closing-inner reveal">
          <p className="section-eyebrow">Your turn</p>
          <h2 className="closing-title">Open your<br /><em>own room.</em></h2>
          <p className="closing-sub">
            Upload your work, compose the space, and send a single link to the world.
          </p>
          <Link className="hero-cta" href="/signup">Create your gallery — free</Link>
          <p className="closing-alt">
            <Link href="/demo">or walk the demo first →</Link>
          </p>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="footer">
        <div className="footer-logo">HAKONIWA</div>
        <p>Your work, given space.</p>
        <nav className="footer-links" aria-label="Footer">
          <a href="#concept">Concept</a>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <Link href="/demo">Demo</Link>
          <Link href="/signin">Sign in</Link>
          <Link href="/signup">Create account</Link>
        </nav>
        <div className="footer-meta">
          <span>Prototype v0.4</span>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <span>© 2026 HAKONIWA</span>
        </div>
      </footer>
    </>
  )
}
