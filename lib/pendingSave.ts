'use client'
// 「1ボタンで保存」の台帳（ユーザー指示 2026-08-13・DECISIONS 同日）。
//
// それまでダッシュボードは**7経路すべてが自動保存**で、入力の 0.5〜0.9 秒後にDBへ書いて
// いた。公開中の部屋はその瞬間に公開面へ出るので、**書きかけが来場者に見えてしまう**。
// 自動保存をやめ、編集は**ここに溜めて**、上帯の保存ボタンでまとめて流す。
//
// 設計の要点:
//  ・**保存する処理そのもの（クロージャ）を溜める。** 「何が変わったか」を宣言的に
//    持ち直すと、7経路それぞれの保存の作り（部屋の行を読み直す・公開中だけ配置を
//    作り直す等）を全部書き写すことになる。呼ぶ側は今までの debounce の中身を
//    そのまま `mark()` に渡すだけでよい。
//  ・**同じ経路の2回目は1回目を置き換える**（最後の内容が正）── debounce と同じ意味。
//    ただし**作品ごとの経路は id ごとに別枠**にする（`kind:id`）。ひとつの枠にすると、
//    2点の作品を続けて直したときに先の作品の変更が消える。
//  ・**流している最中に同じ枠が書き換わったら消さない。** 保存中に同じ欄を触った人の
//    編集を、保存の完了処理で捨ててしまわないように、識別子ではなく**タスクの同一性**で
//    消す枠を決める。
import { create } from 'zustand'

/** 流す順番。**部屋の設定 → 配置 → 作品 → プロフィール**。
 *  `space`/`custom`/`override`/`place` は同じ部屋の行を読み直してから書くので、
 *  後の経路が前の経路の結果を見る順に並べてある。
 *
 *  **`space`（テーマ・間取り・既定の額装＝行を書く）と `design`（Design Tools の色＝
 *  別の列を書く）は別の枠にする。** 同じ枠にしていたため、テーマを変えたあとに壁の色を
 *  触ると**テーマの保存が置き換えられて消えていた**（別視点レビューで検出。しかも画面は
 *  下書きを見ているので、変えたつもりのテーマが表示され続ける）。 */
const ORDER = ['details', 'space', 'design', 'custom', 'override', 'place', 'work', 'profile'] as const

export type PendingKind = (typeof ORDER)[number]

type Task = { kind: PendingKind; run: () => Promise<void> }

interface PendingStore {
  /** キーは `kind`、作品ごとの経路だけ `kind:id`。 */
  tasks: Map<string, Task>
  saving: boolean
  /** 直近の保存が終わった時刻（ボタンの「保存しました」表示用）。 */
  savedAt: number | null
  mark: (kind: PendingKind, id: string | null, run: () => Promise<void>) => void
  /** その枠の保存を取り消す（作品を削除した等、保存する意味が無くなったとき）。 */
  drop: (kind: PendingKind, id?: string | null) => void
  saveAll: () => Promise<{ ok: boolean; failed?: string }>
}

const keyOf = (kind: PendingKind, id: string | null) => (id ? `${kind}:${id}` : kind)

export const usePending = create<PendingStore>((set, get) => ({
  tasks: new Map(),
  saving: false,
  savedAt: null,

  mark(kind, id, run) {
    set((s) => {
      const next = new Map(s.tasks)
      next.set(keyOf(kind, id), { kind, run })
      return { tasks: next }
    })
  },

  drop(kind, id = null) {
    set((s) => {
      if (!s.tasks.has(keyOf(kind, id))) return s
      const next = new Map(s.tasks)
      next.delete(keyOf(kind, id))
      return { tasks: next }
    })
  },

  async saveAll() {
    if (get().saving) return { ok: true }
    const snapshot = get().tasks
    if (!snapshot.size) return { ok: true }
    set({ saving: true })
    const entries = [...snapshot.entries()].sort(
      (a, b) => ORDER.indexOf(a[1].kind) - ORDER.indexOf(b[1].kind)
    )
    const done: string[] = []
    let failed: string | undefined
    for (const [key, task] of entries) {
      try {
        await task.run()
        done.push(key)
      } catch (e) {
        // **そこで止める。** 続けると、失敗した設定を前提に次の経路が書き込む
        // （例: 部屋の設定が入らなかったのに配置だけ作り直す）。
        failed = e instanceof Error ? e.message : String(e)
        break
      }
    }
    set((s) => {
      const next = new Map(s.tasks)
      for (const key of done) {
        // 流している最中に同じ枠が書き換わっていたら**残す**（新しい編集を捨てない）
        if (next.get(key) === snapshot.get(key)) next.delete(key)
      }
      return { tasks: next, saving: false, savedAt: failed ? s.savedAt : Date.now() }
    })
    return { ok: !failed, failed }
  },
}))

/** 未保存の変更があるか。 */
export const useHasPending = () => usePending((s) => s.tasks.size > 0)

/** その枠に未保存の変更があるか（カードごとの「未保存」表示用）。 */
export const usePendingKind = (kind: PendingKind) =>
  usePending((s) => {
    for (const key of s.tasks.keys()) if (key === kind || key.startsWith(`${kind}:`)) return true
    return false
  })
