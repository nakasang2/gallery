-- テーマごとの吊し方(額縁の掛け方)とキャプションの見せ方を保存するための追加
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

-- 額縁の吊し方 / キャプションの見せ方(公開ギャラリーのスナップショットに含める)
alter table public.galleries
  add column if not exists hanging_default text not null default 'wire',
  add column if not exists caption_default text not null default 'side';
