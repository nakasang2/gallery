-- Display price for artworks (REQUIREMENTS §11.28). Free text as the artist typed it
-- (e.g. "¥50,000", "$500", "Ask") — HAKONIWA doesn't process the sale, it just shows the
-- price next to the artist's own purchase link on the artwork panel.
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

alter table public.artworks add column if not exists price text;
