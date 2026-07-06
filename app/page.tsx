import Link from 'next/link'
import LandingEffects from '@/components/landing/LandingEffects'

export default function LandingPage() {
  return (
    <>
      <LandingEffects />

      <nav className="nav" id="nav">
        <Link className="nav-logo" href="/">HAKONIWA</Link>
        <div className="nav-links">
          <a href="#concept">コンセプト</a>
          <a href="#features">できること</a>
          <a href="#flow">使い方</a>
          <a href="#pricing">料金</a>
        </div>
        <Link className="btn btn-small" href="/demo">デモを歩く</Link>
      </nav>

      {/* ============ HERO ============ */}
      <header className="hero">
        <div className="hero-floats" id="hero-floats" aria-hidden="true"></div>
        <div className="hero-inner">
          <p className="hero-eyebrow">VIRTUAL ART GALLERY PLATFORM</p>
          <h1 className="hero-title">
            <span className="line">あなたの作品が、</span>
            <span className="line"><em>空間</em>になる。</span>
          </h1>
          <p className="hero-lead">
            タイムラインで流れて消える一枚を、歩いて出会う一枚へ。<br />
            HAKONIWAは、アートを3Dギャラリーとして展示・公開できるプラットフォームです。
          </p>
          <div className="hero-cta">
            <Link className="btn btn-primary" href="/demo">ギャラリーを歩いてみる</Link>
            <a className="btn btn-ghost" href="#concept">コンセプトを読む</a>
          </div>
        </div>
        <div className="hero-scroll" aria-hidden="true"><span></span>SCROLL</div>
      </header>

      {/* ============ MARQUEE ============ */}
      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          <span>ILLUSTRATION&ensp;·&ensp;PHOTOGRAPHY&ensp;·&ensp;PAINTING&ensp;·&ensp;SUMI-E&ensp;·&ensp;GENERATIVE&ensp;·&ensp;3DCG&ensp;·&ensp;COLLAGE&ensp;·&ensp;GRAPHIC&ensp;·&ensp;</span>
          <span>ILLUSTRATION&ensp;·&ensp;PHOTOGRAPHY&ensp;·&ensp;PAINTING&ensp;·&ensp;SUMI-E&ensp;·&ensp;GENERATIVE&ensp;·&ensp;3DCG&ensp;·&ensp;COLLAGE&ensp;·&ensp;GRAPHIC&ensp;·&ensp;</span>
        </div>
      </div>

      {/* ============ CONCEPT ============ */}
      <section className="concept" id="concept">
        <div className="concept-vertical" aria-hidden="true">箱庭 — じぶんだけの世界を、つくりこむ。</div>
        <div className="concept-body reveal">
          <p className="section-eyebrow">CONCEPT</p>
          <h2 className="section-title">「投稿」ではなく、<br />「展覧会」として見せる。</h2>
          <p className="concept-text">
            SNSのグリッドに並んだ瞬間、作品は他の何万枚かのうちの一枚になります。
            本来その一枚には、見せたい順番があり、余白があり、照明があり、
            足を止めてほしい距離があるはずです。
          </p>
          <p className="concept-text">
            HAKONIWAは、ブラウザの中にあなた専用のギャラリー空間をつくります。
            来場者は部屋を歩き、立ち止まり、近づいて、あなたが設計した文脈のなかで作品と出会う。
            URLをひとつ送るだけで、世界中どこからでも入場できる個展です。
          </p>
          <div className="concept-stats">
            <div className="stat"><b>3分</b><span>で個展をオープン</span></div>
            <div className="stat"><b>0円</b><span>から始められる</span></div>
            <div className="stat"><b>URL1つ</b><span>で世界に公開</span></div>
          </div>
        </div>
      </section>

      {/* ============ FEATURES ============ */}
      <section className="features" id="features">
        <div className="section-head reveal">
          <p className="section-eyebrow">FEATURES</p>
          <h2 className="section-title">できること</h2>
        </div>
        <div className="feature-grid">
          <div className="feature-card reveal">
            <div className="feature-no">01</div>
            <h3>ブラウザだけで、個展</h3>
            <p>アプリもプラグインも不要。リンクを開けばそこがギャラリーの入口。PC・スマホどちらでも歩けます。</p>
          </div>
          <div className="feature-card reveal">
            <div className="feature-no">02</div>
            <h3>ドラッグ&ドロップで展示</h3>
            <p>画像をアップロードして、壁面へ配置するだけ。高さや間隔、順路はテンプレートが美しく整えます。</p>
          </div>
          <div className="feature-card reveal">
            <div className="feature-no">03</div>
            <h3>照明と空間の演出</h3>
            <p>スポットライト・壁色・床材で作品の世界観を演出。一枚ごとに「見せ方」まで設計できます。</p>
          </div>
          <div className="feature-card reveal">
            <div className="feature-no">04</div>
            <h3>URLひとつで招待</h3>
            <p><code>hakoniwa.app/@you</code> — 固有URLを発行。SNSのプロフィールに置けば、常設のポートフォリオに。</p>
          </div>
          <div className="feature-card reveal">
            <div className="feature-no">05</div>
            <h3>キャプションと物語</h3>
            <p>タイトル・制作年・ステートメントを銘板として展示。作品の背景まで、来場者に届きます。</p>
          </div>
          <div className="feature-card reveal">
            <div className="feature-no">06</div>
            <h3>芳名帳とリアクション <small>SOON</small></h3>
            <p>来場の足跡、感想、いいね。展覧会らしい静かなコミュニケーションを設計中です。</p>
          </div>
        </div>
      </section>

      {/* ============ FLOW ============ */}
      <section className="flow" id="flow">
        <div className="section-head reveal">
          <p className="section-eyebrow">HOW IT WORKS</p>
          <h2 className="section-title">個展まで、3ステップ</h2>
        </div>
        <ol className="flow-steps">
          <li className="reveal">
            <span className="flow-no">01</span>
            <h3>作品をアップロード</h3>
            <p>JPG / PNG / WebPに対応。タイトルや説明を添えて、あなたのコレクションに登録します。</p>
          </li>
          <li className="reveal">
            <span className="flow-no">02</span>
            <h3>空間に配置する</h3>
            <p>ギャラリーテンプレートを選び、壁面に作品をレイアウト。照明と順路を整えます。</p>
          </li>
          <li className="reveal">
            <span className="flow-no">03</span>
            <h3>URLで公開する</h3>
            <p>公開ボタンを押せば、あなたの個展が開幕。リンクを共有して来場者を迎えましょう。</p>
          </li>
        </ol>
      </section>

      {/* ============ DEMO ============ */}
      <section className="demo reveal" id="demo">
        <div className="demo-card">
          <div className="demo-art" id="demo-art" aria-hidden="true"></div>
          <div className="demo-body">
            <p className="section-eyebrow">DEMO EXHIBITION</p>
            <h2 className="section-title">まずは、<br />歩いてみてください。</h2>
            <p>
              10人の作家(架空)による常設展「HAKONIWA COLLECTION」を公開中。
              ドラッグで見回し、床をタップして歩き、気になる作品をクリックしてください。
            </p>
            <Link className="btn btn-primary" href="/demo">デモギャラリーに入場する — 無料</Link>
          </div>
        </div>
      </section>

      {/* ============ PRICING ============ */}
      <section className="pricing" id="pricing">
        <div className="section-head reveal">
          <p className="section-eyebrow">PRICING(構想)</p>
          <h2 className="section-title">料金プラン</h2>
        </div>
        <div className="pricing-grid">
          <div className="price-card reveal">
            <h3>Free</h3>
            <div className="price"><b>¥0</b><span>/ 月</span></div>
            <ul>
              <li>ギャラリー 1室</li>
              <li>作品 10点まで</li>
              <li>固有URLで公開</li>
              <li>スマホ対応ビューア</li>
            </ul>
          </div>
          <div className="price-card price-card--pro reveal">
            <div className="price-badge">FOR ARTISTS</div>
            <h3>Pro</h3>
            <div className="price"><b>¥980</b><span>/ 月</span></div>
            <ul>
              <li>ギャラリー無制限</li>
              <li>作品数無制限</li>
              <li>空間カスタマイズ(壁・床・照明・BGM)</li>
              <li>来場者アナリティクス</li>
              <li>独自ドメイン接続</li>
            </ul>
          </div>
        </div>
        <p className="pricing-note reveal">※ 本サービスはプロトタイプ段階です。料金は要件定義上の構想であり、課金は実装されていません。</p>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="footer">
        <div className="footer-logo">HAKONIWA</div>
        <p>あなたの作品が、空間になる。</p>
        <div className="footer-meta">
          <span>Prototype v0.3</span>
          <span>要件定義: REQUIREMENTS.md</span>
          <Link href="/demo">デモギャラリー →</Link>
        </div>
      </footer>
    </>
  )
}
