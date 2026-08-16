'use client'
// 3Dの廊下に並ぶ6枚の訴求パネル、その隣に掛かる1点を差し替える画面。
// 板の文字（`lp.f1Title` …）は辞書から焼くので、ここで扱うのは絵だけ。
// 空の枠は「絵なし」＝板だけが掛かる（内蔵のデモ作品では埋めない ── 訴求の
// 隣に無関係な作品が並ぶより、何も無い方が読みが濁らない）。
import { fetchLpPanels, saveLpPanels, LP_PANEL_SLOTS, LP_PANEL_SLOT_LABEL_KEYS, LP_PANEL_SLOT_OFFSET } from '@/lib/siteConfig'
import LpImageSlotsEditor from '@/components/LpImageSlotsEditor'

export default function LpPanelsEditor() {
  return (
    <LpImageSlotsEditor
      headingKey="adminUi.lpPanels"
      noteKey="adminUi.lpPanelsNote"
      applyNoteKey="adminUi.lpHeroApplyNote"
      count={LP_PANEL_SLOTS}
      labelKeys={LP_PANEL_SLOT_LABEL_KEYS}
      emptyLabelKey="adminUi.noPanelArt"
      slotOffset={LP_PANEL_SLOT_OFFSET}
      fetchSlots={fetchLpPanels}
      saveSlots={saveLpPanels}
    />
  )
}
