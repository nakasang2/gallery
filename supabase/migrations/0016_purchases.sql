-- Purchases ledger (REQUIREMENTS.md §11.x) — the seam a future payment
-- integration (a Stripe webhook, most likely) writes into; entitlements
-- reads from it. Deliberately no insert policy: a real purchase must be
-- verified server-side (the webhook uses the service role key, which
-- bypasses RLS), so there is no client-writable path to grant yourself
-- content for free.
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('theme', 'layout', 'design_tools', 'video_pass')),
  item_key text not null default '', -- theme/layout id; '' for design_tools and video_pass (kept not-null so the unique constraint below actually dedupes)
  created_at timestamptz not null default now(),
  unique (user_id, kind, item_key)
);

alter table purchases enable row level security;

create policy "read own purchases" on purchases
  for select using (auth.uid() = user_id);
