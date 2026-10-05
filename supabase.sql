create table if not exists public.push_subscriptions (
  id uuid primary key,
  endpoint text not null unique,
  device_name text not null,
  subscription jsonb not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

-- No crees politicas para anon/authenticated. El backend accede con la Service Role Key,
-- que nunca debe exponerse en el frontend ni subirse al repositorio.
