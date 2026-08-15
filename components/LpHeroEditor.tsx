'use client'
// Admin editor for the landing-page hero works (migration 0018). Upload up to three
// images (center / left / right); an empty slot falls back to the built-in demo art.
// One setting drives both PC and mobile, since the LP just reads site_config.
//
// 画面そのものは LpImageSlotsEditor（3Dパネルの絵と共用）。ここが持っているのは
// 「ヒーローという面はどこに保存し、枠がいくつで、どう呼ばれるか」だけ。
import { fetchLpHero, saveLpHero, LP_HERO_SLOTS, LP_HERO_SLOT_LABEL_KEYS } from '@/lib/siteConfig'
import LpImageSlotsEditor from '@/components/LpImageSlotsEditor'

export default function LpHeroEditor() {
  return (
    <LpImageSlotsEditor
      headingKey="adminUi.lpHero"
      noteKey="adminUi.lpHeroNote"
      applyNoteKey="adminUi.lpHeroApplyNote"
      count={LP_HERO_SLOTS}
      labelKeys={LP_HERO_SLOT_LABEL_KEYS}
      emptyLabelKey="adminUi.demoDefault"
      slotOffset={0}
      fetchSlots={fetchLpHero}
      saveSlots={saveLpHero}
    />
  )
}
