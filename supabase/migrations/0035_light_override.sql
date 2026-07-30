-- 0035: per-work lighting override (DECISIONS 2026-07-30)
-- 作品ごとの照明モード。既存の4軸（額・マット・掛け方・キャプション）と同じ形の5軸目。
-- 'ceiling'（天井トラック） | 'overhead'（作品の真上のピクチャーライト）。
-- NULL = 部屋の既定（galleries.design_overrides の lightMode）に従う。
alter table placements add column if not exists light_override text;
