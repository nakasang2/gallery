'use client'
// LPの3D美術館 ③ **最後の部屋**（Closing で霧の奥から現れる大部屋）。2つの帯を持つ:
//   ・正面の壁（3枚）… 到着地点。中央が一番大きく、明るく照らしている。
//   ・左右の壁（4枚）… 歩きながら見る脇の作品（手前 / 奥 × 左 / 右）。
// 空の枠はどちらも内蔵のデモ作品のまま（ユーザー選択 2026-08-20）。
import {
  fetchLpHallFront,
  saveLpHallFront,
  fetchLpHallSides,
  saveLpHallSides,
  LP_HALL_FRONT_SLOTS,
  LP_HALL_FRONT_SLOT_LABEL_KEYS,
  LP_HALL_FRONT_SLOT_OFFSET,
  LP_HALL_SIDE_SLOTS,
  LP_HALL_SIDE_SLOT_LABEL_KEYS,
  LP_HALL_SIDE_SLOT_OFFSET,
} from '@/lib/siteConfig'
import LpImageSlotsEditor, { type LpImageBand } from '@/components/LpImageSlotsEditor'

const BANDS: readonly LpImageBand[] = [
  {
    titleKey: 'adminUi.lpBandHallFront',
    count: LP_HALL_FRONT_SLOTS,
    labelKeys: LP_HALL_FRONT_SLOT_LABEL_KEYS,
    emptyLabelKey: 'adminUi.demoDefault',
    slotOffset: LP_HALL_FRONT_SLOT_OFFSET,
    fetchSlots: fetchLpHallFront,
    saveSlots: saveLpHallFront,
  },
  {
    titleKey: 'adminUi.lpBandHallSides',
    count: LP_HALL_SIDE_SLOTS,
    labelKeys: LP_HALL_SIDE_SLOT_LABEL_KEYS,
    emptyLabelKey: 'adminUi.demoDefault',
    slotOffset: LP_HALL_SIDE_SLOT_OFFSET,
    fetchSlots: fetchLpHallSides,
    saveSlots: saveLpHallSides,
  },
]

export default function LpHallEditor() {
  return <LpImageSlotsEditor headingKey="adminUi.lpHall" noteKey="adminUi.lpHallNote" applyNoteKey="adminUi.lpHeroApplyNote" bands={BANDS} />
}
