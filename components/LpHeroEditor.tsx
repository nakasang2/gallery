'use client'
// LPの3D美術館 ① **1st View**（入口・右壁の3枚。migration 0018）。3枠まで画像を上げ、
// 空の枠は内蔵のデモ作品にフォールバックする。1つの設定でPCとスマホの両方が変わる
// （LPは site_config をそのまま読むだけ）。
//
// 画面そのものは LpImageSlotsEditor（LPの他の面と共用）。ここが持っているのは
// 「この節はどこの絵で、どこに保存し、枠がいくつで、どう呼ばれるか」だけ。
import { fetchLpHero, saveLpHero, LP_HERO_SLOTS, LP_HERO_SLOT_LABEL_KEYS } from '@/lib/siteConfig'
import LpImageSlotsEditor, { type LpImageBand } from '@/components/LpImageSlotsEditor'

// 帯はモジュールの外に置く（毎レンダーで作り直すと、読み込みの effect が回り続ける）
const BANDS: readonly LpImageBand[] = [
  {
    count: LP_HERO_SLOTS,
    labelKeys: LP_HERO_SLOT_LABEL_KEYS,
    emptyLabelKey: 'adminUi.demoDefault',
    slotOffset: 0,
    fetchSlots: fetchLpHero,
    saveSlots: saveLpHero,
  },
]

export default function LpHeroEditor() {
  return <LpImageSlotsEditor headingKey="adminUi.lpHero" noteKey="adminUi.lpHeroNote" applyNoteKey="adminUi.lpHeroApplyNote" bands={BANDS} />
}
