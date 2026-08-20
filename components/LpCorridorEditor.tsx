'use client'
// LPの3D美術館 ② **廊下**。2つの帯を持つ:
//   ・訴求パネルの絵（6枚）… 板の隣ではなく**板の代わり**に掛かる（2026-08-17）。
//     板の文字（`lp.f1Title` …）は辞書から焼くので、ここで扱うのは絵だけ。空の枠は
//     「絵なし」＝板だけが掛かる（訴求の隣に無関係な作品が並ぶより読みが濁らない）。
//   ・通路の作品（7枚）… 廊下を抜けた暗い区間の両壁。中間セクション（Concept〜
//     Pricing）の背景になる。空の枠は内蔵のデモ作品のまま（壁が空くと未完成に見える
//     ── ユーザー選択 2026-08-20）。
import {
  fetchLpPanels,
  saveLpPanels,
  fetchLpApproach,
  saveLpApproach,
  LP_PANEL_SLOTS,
  LP_PANEL_SLOT_LABEL_KEYS,
  LP_PANEL_SLOT_OFFSET,
  LP_APPROACH_SLOTS,
  LP_APPROACH_SLOT_LABEL_KEYS,
  LP_APPROACH_SLOT_OFFSET,
} from '@/lib/siteConfig'
import LpImageSlotsEditor, { type LpImageBand } from '@/components/LpImageSlotsEditor'

const BANDS: readonly LpImageBand[] = [
  {
    titleKey: 'adminUi.lpBandPanels',
    count: LP_PANEL_SLOTS,
    labelKeys: LP_PANEL_SLOT_LABEL_KEYS,
    emptyLabelKey: 'adminUi.noPanelArt',
    slotOffset: LP_PANEL_SLOT_OFFSET,
    fetchSlots: fetchLpPanels,
    saveSlots: saveLpPanels,
  },
  {
    titleKey: 'adminUi.lpBandApproach',
    count: LP_APPROACH_SLOTS,
    labelKeys: LP_APPROACH_SLOT_LABEL_KEYS,
    emptyLabelKey: 'adminUi.demoDefault',
    slotOffset: LP_APPROACH_SLOT_OFFSET,
    fetchSlots: fetchLpApproach,
    saveSlots: saveLpApproach,
  },
]

export default function LpCorridorEditor() {
  return <LpImageSlotsEditor headingKey="adminUi.lpCorridor" noteKey="adminUi.lpCorridorNote" applyNoteKey="adminUi.lpHeroApplyNote" bands={BANDS} />
}
