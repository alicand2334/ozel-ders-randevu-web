-- |--------------------------------------------------------------------------
-- Migration: 0044_push_subscriptions.sql
-- Açıklama: Web Push bildirimleri için subscription tablosu oluşturur.
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.profiles (id uuid, role text) -> halihazırda mevcut
-- ---------------------------------------------------------------------------
-- Veri modeli notları:
--   - Bir kullanıcının birden fazla cihazı olabilir (her cihaz ayrı subscription)
--   - endpoint unique constraint ile aynı cihazın tekrar kaydı engellenir
--   - VAPID keys: p256dh (public key) ve auth (secret) şifreleme için
--   - is_active ile kullanıcı bildirimleri kapatırsa subscription devre dışı bırakılır
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
    id uuid primary key default gen_random_uuid(),

    -- Subscription sahibi kullanıcı
    user_id uuid not null
        references public.profiles(id) on delete cascade,

    -- Push endpoint (browser/device unique)
    endpoint text not null,

    -- VAPID encryption keys
    p256dh text not null,
    auth text not null,

    -- Kullanıcı bildirimleri kapatırsa false yapılır (silinmez, sadece devre dışı bırakılır)
    is_active boolean not null default true,

    -- Tarayıcı/cihaz bilgisi (debug için opsiyonel)
    user_agent text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- Aynı endpoint için tekrar kayıt engelle (bir cihaz bir kez kaydolur)
    constraint push_subscriptions_endpoint_unique unique (endpoint)
);

-- İndeksler
create index if not exists push_subscriptions_user_id_idx
    on public.push_subscriptions (user_id, created_at desc);

create index if not exists push_subscriptions_user_active_idx
    on public.push_subscriptions (user_id)
    where is_active = true;

-- RLS
alter table public.push_subscriptions enable row level security;

-- Okuma: kullanıcı kendi subscriptionlarını görür
drop policy if exists push_subscriptions_select_policy on public.push_subscriptions;
create policy push_subscriptions_select_policy
    on public.push_subscriptions
    for select
    to authenticated
    using (user_id = auth.uid());

-- Ekleme: kullanıcı kendi subscriptionını ekler (client-side)
drop policy if exists push_subscriptions_insert_policy on public.push_subscriptions;
create policy push_subscriptions_insert_policy
    on public.push_subscriptions
    for insert
    to authenticated
    with check (user_id = auth.uid());

-- Güncelleme: kullanıcı kendi subscriptionını günceller (is_active toggle vb.)
drop policy if exists push_subscriptions_update_policy on public.push_subscriptions;
create policy push_subscriptions_update_policy
    on public.push_subscriptions
    for update
    to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- Silme: kullanıcı kendi subscriptionını siler
drop policy if exists push_subscriptions_delete_policy on public.push_subscriptions;
create policy push_subscriptions_delete_policy
    on public.push_subscriptions
    for delete
    to authenticated
    using (user_id = auth.uid());

-- GRANT
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;