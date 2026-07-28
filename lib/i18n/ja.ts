// Japanese. Typed against the English shape (lib/i18n/en), so removing or
// renaming a key there breaks the build here instead of silently shipping a
// blank label.
//
// Tone: the English copy is written like a gallery, not like software, and the
// Japanese should read the same way — plain 敬体, no exclamation marks, no
// カタカナ英語 where a normal word exists. Most of these are read by an
// artist's followers, who did not come here to learn an interface.
import type { Dictionary } from './en'

export const ja: Dictionary = {
  common: {
    close: '閉じる',
    cancel: 'キャンセル',
    save: '保存',
    saving: '保存中…',
    saved: '保存しました',
    retry: 'もう一度試す',
    startFree: '無料ではじめる',
    signIn: 'サインイン',
    dashboard: 'ダッシュボード',
    language: '言語',
  },

  hud: {
    tour: '順路で見る',
    endTour: '順路を終える',
    bgmOn: 'BGM オン',
    bgmOff: 'BGM オフ',
    share: '共有',
    guestbook: '芳名帳',
    editSpace: '空間を編集',
    others: 'その他',
    closeMenu: 'メニューを閉じる',
    report: '通報',
    reportAria: 'この展示を通報する',
    record: '録画',
    recordAria: '歩いた様子を録画する',
    stop: '停止',
    stopAria: '録画を停止する',
    linkCopied: 'リンクをコピーしました',
    yourSpace: 'あなたの空間',
    livePublished: '公開中 — 保存するとすぐ反映されます',
    privateDraft: '非公開の下書き',
    yourExhibition: 'あなたの展示',
    open: '開く ↗',
    houseTitle: 'XIBIT360 コレクション',
    houseSub: '常設展 — 10点',
  },

  hint: {
    drag: 'ドラッグ',
    dragWhat: '歩く・向きを変える',
    tap: 'タップ',
    tapWhat: '床で移動 · 作品で鑑賞',
    step: '次の作品',
  },

  loading: {
    nowShowing: '開催中',
    openingDoors: '扉を開けています…',
    preparing: '会場を準備しています…',
  },

  contextLost: {
    title: '描画との接続が切れました。',
    body: '端末のメモリが少ないときや、他のアプリに切り替えたときに起きることがあります。',
    rebuild: '会場を組み直す',
  },

  guestbook: {
    title: '芳名帳',
    subtitle: '{name} さんへ一言のこす。',
    namePlaceholder: 'お名前（任意）',
    messagePlaceholder: 'ご感想を…',
    sign: '記帳する',
    thanks: 'ありがとうございました',
    anonymous: '名前なし',
    unavailable: 'この展示では芳名帳を利用できません。',
    closed: '{name} さんはこの展示の芳名帳を閉じています。',
    empty: 'まだ記帳はありません。最初のひとりになってください。',
  },

  artwork: {
    forSale: 'この作品を購入する ↗',
    readAloud: '読み上げる',
    stopReading: '停止',
    next: '次の作品',
    previous: '前の作品',
  },

  explore: {
    title: '展示をさがす',
    intro:
      'いま公開されているすべての展示です。更新の新しい順に並んでいます。どの部屋も、ブラウザのまま3Dで歩けます。',
    emptyState: 'まだ公開されている展示はありません。最初のひとりになってください。',
    walkThrough_one: '{count}点 · 3Dで歩く →',
    walkThrough_other: '{count}点 · 3Dで歩く →',
    loadMore: 'もっと見る',
  },

  auth: {
    createAccount: 'アカウントを作る',
    displayName: '表示名（任意）',
    displayNameHint: '作家名として表示されます',
    email: 'メールアドレス',
    password: 'パスワード（{min}文字以上）',
    confirmPassword: 'パスワード（確認）',
    consent: '利用規約とプライバシーポリシーに同意し、18歳以上です。',
    consentRequired: '利用規約とプライバシーポリシーへの同意が必要です。',
    passwordTooShort: 'パスワードは{min}文字以上にしてください。',
    passwordMismatch: 'パスワードが一致しません。',
    continueWithGoogle: 'Google ではじめる',
    haveAccount: 'アカウントをお持ちですか？サインイン',
    checkInbox: 'メールをご確認ください',
    resend: 'メールを再送する',
    backToSignIn: 'サインインに戻る',
    notConfigured: 'クラウド機能が設定されていません（.env.local に Supabase のキーが必要です）。',
  },

  report: {
    title: '問題を報告する',
    whatLabel: '何についての報告ですか',
    whatPlaceholder: '@ユーザー名/展示名 または URL',
    whyLabel: '理由（著作権・嫌がらせ・違法な内容など）',
    contactLabel: 'ご連絡先（任意・追って確認する場合に使います）',
    contactPlaceholder: 'メールアドレスまたはハンドル',
    send: '報告を送る',
    thanksTitle: 'ありがとうございました',
    thanksBody: 'ご報告を受け取りました。内容を確認し、規約に反するものは公開を停止します。',
    failed: '報告を送れませんでした。時間をおいて、もう一度お試しください。',
    unavailable: '報告機能を利用できません（Supabase が未設定です）。',
  },

  footer: {
    terms: '利用規約',
    privacy: 'プライバシー',
    legal: '特定商取引法に基づく表記',
    guides: 'ガイド',
    home: 'ホーム',
    explore: '展示をさがす',
  },
}
