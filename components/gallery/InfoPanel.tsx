'use client'
// Exhibition-info panel — the "detail UI" for the title wall (opened by clicking it),
// the board's counterpart to the per-work ArtworkPanel. Reuses the .panel drawer.
//
// **3つのタブに分ける**（ユーザー要望 2026-08-13: 展示情報／自己紹介／来歴）。1枚に積むと
// 「展示のステートメント → 作家の自己紹介 → 年号の羅列」が延々と続き、どれも読まれない。
// **中身の無いタブは出さない** ── 空のタブを押させるのは、無いことを確かめる手間だけを
// 増やす。1つしか無ければタブ列そのものを出さない（見出しの意味がないので）。
import { useEffect, useMemo, useState } from 'react'
import { useGallery } from '@/lib/store'
import { isPlaceholderTitle, EMPTY_SNS, type SnsLinks as SnsLinksData } from '@/lib/publish'
import { roomExhibitor } from '@/lib/roomPlan'
import { DEFAULT_TITLE_TEXT } from './textures'
import { useT } from '@/components/I18nProvider'
import SnsLinks from '@/components/SnsLinks'

type TabId = 'exhibition' | 'about' | 'cv'

export default function InfoPanel() {
  const t = useT()
  const infoOpen = useGallery((s) => s.infoOpen)
  const setInfoOpen = useGallery((s) => s.setInfoOpen)
  const visitor = useGallery((s) => s.visitor)
  const user = useGallery((s) => s.user)
  const myGallery = useGallery((s) => s.myGallery)
  const displayName = useGallery((s) => s.profileDisplayName)
  const bio = useGallery((s) => s.profileBio)
  const cvOwn = useGallery((s) => s.profileCv)

  const eyebrow = 'Exhibition'
  // Defaults are the /demo board copy; visitor / owner override with their own
  let title = DEFAULT_TITLE_TEXT.title
  let exhibitor = ''
  let statement = DEFAULT_TITLE_TEXT.statement ?? ''
  let artistBio = ''
  let artistCv = ''
  let sns: SnsLinksData = EMPTY_SNS

  if (visitor) {
    // Same derivation as the board it belongs to (lib/roomPlan.roomExhibitor): the
    // artist when this room is theirs alone, the collective when the walls are mixed.
    const by = roomExhibitor(visitor)
    title = isPlaceholderTitle(visitor.title) ? by.name : visitor.title
    exhibitor = by.name
    statement = visitor.statement
    artistBio = by.bio
    artistCv = by.cv
    sns = by.sns
  } else if (user && myGallery) {
    title = isPlaceholderTitle(myGallery.title) ? displayName || 'Your exhibition' : myGallery.title
    exhibitor = displayName || ''
    statement = myGallery.statement
    artistBio = bio ?? ''
    artistCv = cvOwn ?? ''
  }

  // 出せるタブだけを並べる。展示情報はタイトルと作家名があるので常にある。
  const tabs = useMemo(() => {
    const out: { id: TabId; label: string }[] = [{ id: 'exhibition', label: t('artwork.tabExhibition') }]
    if (artistBio.trim()) out.push({ id: 'about', label: t('artwork.aboutArtist') })
    if (artistCv.trim()) out.push({ id: 'cv', label: t('artwork.tabCv') })
    return out
  }, [artistBio, artistCv, t])

  const [tab, setTab] = useState<TabId>('exhibition')
  // 中身が変わってタブが消えることがある（別の部屋へ移ると作家が替わる）。選択が
  // 無くなったタブに残ると**本文が空のパネル**になるので、先頭へ戻す。
  useEffect(() => {
    if (!tabs.some((x) => x.id === tab)) setTab('exhibition')
  }, [tabs, tab])
  // 開くたびに展示情報から始める。前回どのタブを見たかは、次に開くときの関心とは無関係。
  useEffect(() => {
    if (infoOpen) setTab('exhibition')
  }, [infoOpen])

  const shown: TabId = tabs.some((x) => x.id === tab) ? tab : 'exhibition'

  return (
    <aside id="info-panel" className={`panel${infoOpen ? ' open' : ''}`} aria-hidden={!infoOpen} inert={!infoOpen}>
      <button className="panel-close" aria-label={t('common.close')} onClick={() => setInfoOpen(false)}>
        ×
      </button>
      <div className="panel-no">{eyebrow}</div>
      <h2 className="panel-title">{title}</h2>
      {exhibitor && <div className="panel-artist">{exhibitor}</div>}
      {/* 上部（タイトル・作家名の直下）に置く（ユーザー指摘 2026-08-12: 「SNS情報は
          タイトルなどの直下に」— 以前は本文の下、パネルの最後尾にあった）。 */}
      <SnsLinks sns={sns} className="panel-sns" />
      {/* タブは `role="tablist"`。矢印キーの移動まで持つのが WAI-ARIA の作法だが、
          ここは**タブ自体をフォーカス可能なボタン**にして Tab キーで順に回れる形にする
          （手動activationのタブと同じ操作感で、実装の取りこぼしが起きない）。 */}
      {/* `aria-label` は付けない ── 「展示情報」など先頭のタブ名を借りると、読み上げが
          「展示情報タブリスト、展示情報タブ、選択中」になって取り違えを誘う。この
          タブ列は見出し（`.panel-title`）を持つパネルの中にある。 */}
      {tabs.length > 1 && (
        <div className="panel-tabs" role="tablist">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              id={`info-tab-${x.id}`}
              aria-selected={shown === x.id}
              aria-controls={`info-pane-${x.id}`}
              className={`panel-tab${shown === x.id ? ' is-on' : ''}`}
              onClick={() => setTab(x.id)}
            >
              {x.label}
            </button>
          ))}
        </div>
      )}
      {shown === 'exhibition' && (
        <div role="tabpanel" id="info-pane-exhibition" aria-labelledby="info-tab-exhibition">
          {statement && <p className="panel-desc">{statement}</p>}
        </div>
      )}
      {shown === 'about' && (
        <div role="tabpanel" id="info-pane-about" aria-labelledby="info-tab-about">
          <p className="panel-desc">{artistBio}</p>
        </div>
      )}
      {shown === 'cv' && (
        <div role="tabpanel" id="info-pane-cv" aria-labelledby="info-tab-cv">
          {/* 来歴は1行1件で書かれる（ダッシュボードの説明文がそう案内している）ので、
              改行をそのまま残す。段落として流すと年号が繋がって読めない。 */}
          <p className="panel-desc panel-desc-lines">{artistCv}</p>
        </div>
      )}
    </aside>
  )
}
