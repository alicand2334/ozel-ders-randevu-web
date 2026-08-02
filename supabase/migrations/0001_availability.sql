-- |--------------------------------------------------------------------------
-- Migration: 0001_availability.sql
-- Açıklama: Öğretmenlerin uygun ders saatlerini tutan tablo.
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.profiles (id uuid, role text)  -> halihazırda oluşturuldu
--
-- Notlar:
--   - Bir kayıt = bir öğretmenin belirli bir tarih için tek bir slot'u.
--   - start_time/end_time aynı gün içinde; timestamptz değil TIME kullanılır,
--     tarih `available_date` üzerinden ayrı tutulur.
--   - status: 'open' (müsait) | 'booked' (dolu) | 'blocked' (kapalı).
--   - Çakışan slot eklemek uygulama katmanında engellenir; burada yalnızca
--     süre tutarlılığı (end > start) DB düzeyinde garanti edilir.
-- ---------------------------------------------------------------------------

create table if not exists public.availability (
    id uuid primary key default gen_random_uuid(),

    teacher_id uuid not null
        references public.profiles(id) on delete cascade,

    available_date date not null,
    start_time time not null,
    end_time   time not null,

    status text not null default 'open'
        check (status in ('open', 'booked', 'blocked')),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- Bitiş başlangıçtan sonra olmalı
    constraint availability_time_order_chk check (end_time > start_time)
);

-- Tek bir öğretmen için aynı tarih ve saat aralığında birden fazla slot oluşmasını engelle
create unique index if not exists availability_teacher_slot_uniq
    on public.availability (teacher_id, available_date, start_time, end_time);

-- Sık erişilen sorgular için indeksler
create index if not exists availability_teacher_date_idx
    on public.availability (teacher_id, available_date)
    where status = 'open';

create index if not exists availability_status_idx
    on public.availability (status);

-- RLS
alter table public.availability enable row level security;

-- Okuma: onaylı öğretmenlerin próp slotları + öğrenciler açık slotları görebilir.
-- Pratik tutum: tablo her giriş yapmış kullanıcı tarafından okunabilir
-- (öğretmenler kendi slotlarını, öğrenciler açık aralıkları görür).
drop policy if exists availability_read_policy on public.availability;
create policy availability_read_policy
    on public.availability
    for select
    to authenticated
    using (true);

-- Ekleme: yalnızca teacher rolündeki kullanıcılar kendi adlarına slot ekler.
drop policy if exists availability_insert_policy on public.availability;
create policy availability_insert_policy
    on public.availability
    for insert
    to authenticated
    with check (
        teacher_id = auth.uid()
        and exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.role = 'teacher'
        )
    );

-- Güncelleme/Silme: yalnızca slot sahibi öğretmen.
drop policy if exists availability_update_policy on public.availability;
create policy availability_update_policy
    on public.availability
    for update
    to authenticated
    using (teacher_id = auth.uid())
    with check (teacher_id = auth.uid());

drop policy if exists availability_delete_policy on public.availability;
create policy availability_delete_policy
    on public.availability
    for delete
    to authenticated
    using (teacher_id = auth.uid());
