-- 0066: Design Tools（壁・床・光の色と光の強さ）の保存済みの値を消す。
--
-- 背景: 2026-08-17 のユーザー決定で Design Tools を画面から撤去した（部屋タブを
-- 「選ぶだけの場所」にし、見た目はテーマが決める形にする）。アプリ側は同じ日に
-- `resolveTheme` から色の上書きを外したので、**この migration を当てなくても
-- 見た目はテーマどおりに戻る**。ここで消すのは残った値そのもの ── 残しておくと
-- 「画面には無いのにDBには入っている」状態が延々と続き、次に `design_overrides`
-- を触る人が「これは何のために入っているのか」を必ず調べ直すことになる。
--
-- 消すキー: wall / floor / lightColor / lightIntensity / lightMode
--   lightMode（作品のスポットの当て方）も**部屋ごとの設定としては撤去した**ので消す。
--   作品ごとの上書きは `artworks` 側（overrides.lights）にあり、ここは触らない。
-- 残すキー: logoUrl（色ではなく作家の持ち物。画面にも残っている）
--
-- 再実行安全。すでに消えている行は `-` が何もしないので更新されない。
-- 1文だけなので begin/commit で囲まない（単文はそれ自体がトランザクション）。
update public.galleries
set design_overrides = design_overrides - 'wall' - 'floor' - 'lightColor' - 'lightIntensity' - 'lightMode'
where design_overrides is not null
  and design_overrides ?| array['wall', 'floor', 'lightColor', 'lightIntensity', 'lightMode'];
