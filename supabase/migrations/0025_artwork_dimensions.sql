-- Physical dimensions and medium for artworks (REQUIREMENTS §11.x). The pixel
-- width/height columns stay as-is (they drive the image ratio); these are the
-- artist-declared real-world size (cm) and medium, shown on the label and used
-- to size the piece to its true proportions/scale in 3D.
-- 適用方法: SQL Editor に貼り付けて Run(再実行安全)

alter table public.artworks add column if not exists width_cm real;
alter table public.artworks add column if not exists height_cm real;
alter table public.artworks add column if not exists medium text;
