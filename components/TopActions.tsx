'use client'
// ダッシュボード上部（/me・/admin）の行き先をまとめる帯。
//
// 幅を問わず常にハンバーガー1つに畳む（2026-08-10、ユーザー指摘: PCで右上に
// ボタンが並ぶのを廃止）。もともとは375px幅での折れ対策だった
// （実測: 行の高さ59px、3つとも2行。ユーザー指摘 2026-07-29）。
//
// 中身は呼び出し側から渡す。/me は「展示をさがす / 管理 / サインアウト」、
// /admin は「ダッシュボード / 再読み込み / サインアウト」で、並びが違う。
//
// `before` は**畳まれない場所**に置くもの（通知のベル）。畳んだ中に入れると、
// 未読の数字がハンバーガーを開くまで見えない＝**気づけない通知**になる
// （実測 2026-08-09。通知を作った目的そのものを壊すので、ベルだけは外に出す）。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MenuIcon } from '@/components/icons'
import { useT } from '@/components/I18nProvider'

export default function TopActions({ before, children }: { before?: ReactNode; children: ReactNode }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    // 外側を押す / Escape で閉じる（開いたまま本文を触ってしまうのを防ぐ）
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="me-top-nav" ref={wrap}>
      {before}
      <button
        className="me-top-burger"
        aria-label={t('me.menu')}
        aria-expanded={open}
        aria-controls="me-top-actions"
        onClick={() => setOpen((v) => !v)}
      >
        <MenuIcon />
      </button>
      {/* 項目を押したら閉じる。遷移する項目でも、戻ってきたときに開いたままにしない。
          キーボードの Enter/Space はその項目自身の click を通るので、ここで拾える。 */}
      <div id="me-top-actions" className={`me-top-actions${open ? ' open' : ''}`} onClick={() => setOpen(false)}>
        {children}
      </div>
    </div>
  )
}
