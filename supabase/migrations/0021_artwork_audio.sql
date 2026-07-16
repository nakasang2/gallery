-- Per-work audio guide (REQUIREMENTS §6-3 / STRATEGY P3-12): a short narration
-- that plays as the visitor reaches each work — the automatic version turns the
-- guided tour into an audio tour. The file lives in the artworks storage bucket
-- (owner's folder); this column just holds its public URL, mirroring
-- artworks.purchase_url (0015). No schema beyond one nullable column.
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

alter table public.artworks add column if not exists audio_url text;
