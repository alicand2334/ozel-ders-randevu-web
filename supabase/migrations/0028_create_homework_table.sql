-- |--------------------------------------------------------------------------
-- | Migration: 0028_create_homework_table.sql
-- | Açıklama:
-- |   Öğretmen-öğrenci ödev takibi için homework tablosu oluşturur.
-- |   Tabloda id, teacher_id, student_id, title, description, due_date,
-- |   status (assigned/completed/overdue), created_at, updated_at sütunları
-- |   bulunur. RLS politikaları ile sadece ilgili öğretmen ve öğrenci
-- |   erişim sağlanır.
-- |--------------------------------------------------------------------------
-- | Bağımlılıklar:
-- |   public.profiles (id uuid, role text, is_active boolean) -> mevcut
-- |   public.teacher_students (teacher_id, student_id)          -> mevcut
-- |--------------------------------------------------------------------------

-- ===========================================================================
-- A) Tablo oluştur
-- ===========================================================================
create table if not exists public.homework (
    id uuid primary key default gen_random_uuid(),
    teacher_id uuid not null
        references public.profiles(id) on delete cascade,
    student_id uuid not null
        references public.profiles(id) on delete cascade,
    title text not null,
    description text,
    due_date date not null,
    status text not null default 'assigned'
        check (status in ('assigned', 'completed', 'overdue')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ===========================================================================
-- B) İndeksler (sorgu performansı)
-- ===========================================================================
-- Öğretmenin kendi ödevlerini listelemesi
create index if not exists homework_teacher_idx
    on public.homework (teacher_id, created_at desc);

-- Öğrencinin kendi ödevlerini listelemesi
create index if not exists homework_student_idx
    on public.homework (student_id, created_at desc);

-- ===========================================================================
-- C) Row Level Security
-- ===========================================================================
alter table public.homework enable row level security;

-- Yardımcı yardımcı: teacher_students tablosunda ilişki var mı?
-- Bu fonksiyonu policy içinde kullanmak yerine doğrudan exists kullanacağız.

-- ---------------------------------------------------------------------------
-- C1) SELECT – okuma
-- ---------------------------------------------------------------------------
drop policy if exists homework_select_policy on public.homework;
create policy homework_select_policy
    on public.homework
    for select
    to authenticated
    using (
        -- Kullanıcı öğretmen veya öğrenci olup teacher_students ilişkisi olan
        exists (
            select 1 from public.teacher_students ts
            where ts.teacher_id = homework.teacher_id
              and ts.student_id = homework.student_id
        )
        and (
            homework.teacher_id = auth.uid()
            or homework.student_id = auth.uid()
        )
    );

-- ---------------------------------------------------------------------------
-- C2) INSERT – ekleme (sadece öğretmen)
-- ---------------------------------------------------------------------------
drop policy if exists homework_insert_policy on public.homework;
create policy homework_insert_policy
    on public.homework
    for insert
    to authenticated
    with check (
        -- Öğretmen kimliği doğrulanmalı
        exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.role = 'teacher'
              and p.is_active = true
        )
        and -- teacher_id oturumdaki kullanıcıyla eşleşmeli
        homework.teacher_id = auth.uid()
        and -- öğrenci ilişkisi teacher_students içinde olmalı
        exists (
            select 1 from public.teacher_students ts
            where ts.teacher_id = homework.teacher_id
              and ts.student_id = homework.student_id
        )
    );

-- ---------------------------------------------------------------------------
-- C3) UPDATE – güncelleme (sadece öğretmen)
-- ---------------------------------------------------------------------------
drop policy if exists homework_update_policy on public.homework;
create policy homework_update_policy
    on public.homework
    for update
    to authenticated
    using (
        -- Öğretmen kimliği doğrulanmalı
        exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.role = 'teacher'
              and p.is_active = true
        )
        and -- teacher_id oturumdaki kullanıcıyla eşleşmeli
        homework.teacher_id = auth.uid()
        and -- öğrenci ilişkisi teacher_students içinde olmalı
        exists (
            select 1 from public.teacher_students ts
            where ts.teacher_id = homework.teacher_id
              and ts.student_id = homework.student_id
        )
    )
    with check (
        -- Aynı koşullar uygulanır (teacher_id ve ilişkili student)
        exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.role = 'teacher'
              and p.is_active = true
        )
        and homework.teacher_id = auth.uid()
        and exists (
            select 1 from public.teacher_students ts
            where ts.teacher_id = homework.teacher_id
              and ts.student_id = homework.student_id
        )
    );

-- ---------------------------------------------------------------------------
-- C4) DELETE – silme (sadece öğretmen)
-- ---------------------------------------------------------------------------
drop policy if exists homework_delete_policy on public.homework;
create policy homework_delete_policy
    on public.homework
    for delete
    to authenticated
    using (
        -- Öğretmen kimliği doğrulanmalı
        exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.role = 'teacher'
              and p.is_active = true
        )
        and -- teacher_id oturumdaki kullanıcıyla eşleşmeli
        homework.teacher_id = auth.uid()
        and -- öğrenci ilişkisi teacher_students içinde olmalı
        exists (
            select 1 from public.teacher_students ts
            where ts.teacher_id = homework.teacher_id
              and ts.student_id = homework.student_id
        )
    );

-- ===========================================================================
-- D) GRANT – en az yetki prensibi
-- ===========================================================================
revoke all on public.homework from public, anon, authenticated;
grant select on public.homework to authenticated;
grant insert on public.homework to authenticated;
grant update on public.homework to authenticated;
grant delete on public.homework to authenticated;
-- NOT: RLS politikaları üzerinden erişim kısıtlanır; raw yetkiler verilmez.