-- |--------------------------------------------------------------------------
-- Migration: 0002_appointments.sql
-- Açıklama: Öğrenci - öğretmen randevularını tutan tablo.
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.profiles      (id uuid, role text)  -> var
--   public.availability  (id uuid, teacher_id, available_date, start_time, end_time, status) -> 0001
--
-- Veri modeli notları:
--   - Bir randevu, bir availability slot'una bağlanır (slot_id), böylece
--     öğretmen-gün-saat tutarlılığı tek kaynak üzerinden gelir.
--   - status: pending (beklemede) | confirmed (onaylandı) | cancelled (iptal)
--            | completed (tamamlandı)
--   - Aynı slot'a birden fazla "aktif" randevu (pending/confirmed) eklenmesini
--     DB + trigger ile engelliyoruz (0003'te).
--   - student_id auth.uid() ile aynı olmalı; teacher_id slot'tan türetilir.
-- ---------------------------------------------------------------------------

create table if not exists public.appointments (
    id uuid primary key default gen_random_uuid(),

    slot_id uuid not null
        references public.availability(id) on delete restrict,

    student_id uuid not null
        references public.profiles(id) on delete cascade,

    -- teacher_id slot_kullanıcı_üzerinden türetilebilir; ancak sorgularda
    -- kolaylık ve indeksleme için burada da tutulur. trigger ile doldurulur.
    teacher_id uuid not null
        references public.profiles(id) on delete cascade,

    subject text,
    notes   text,

    status text not null default 'pending'
        check (status in ('pending', 'confirmed', 'cancelled', 'completed')),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- Öğrenci ve öğretmen farklı kişiler olmalı
    constraint appointments_student_teacher_diff_chk
        check (student_id <> teacher_id)
);

-- Sık kullanılan sorgu desenleri için indeksler
create index if not exists appointments_student_idx
    on public.appointments (student_id, created_at desc);

create index if not exists appointments_teacher_idx
    on public.appointments (teacher_id, created_at desc);

create index if not exists appointments_slot_idx
    on public.appointments (slot_id);

create index if not exists appointments_status_idx
    on public.appointments (status);

-- Bir slot için yalnızca bir adet "aktif" randevu olabilmesini garanti eden
-- kısmi benzersiz indeks. pending veconfirmed durumları için benzersizlik:
create unique index if not exists appointments_active_slot_uniq
    on public.appointments (slot_id)
    where status in ('pending', 'confirmed');

-- RLS
alter table public.appointments enable row level security;

-- Okuma: randevu, ilgili öğrenci veya öğretmen tarafından görülebilir.
drop policy if exists appointments_read_policy on public.appointments;
create policy appointments_read_policy
    on public.appointments
    for select
    to authenticated
    using (
        student_id = auth.uid() or teacher_id = auth.uid()
    );

-- Ekleme: yalnızca student rolündeki kullanıcılar kendi adlarına randevu oluşturur.
-- teacher_id burada istemci tarafından gönderilmez; trigger doldurur. Politika
-- yine de teacher_id ile student_id'nin eşit olmadığını ve rolün student olduğunu
-- doğrular. slot_id dahil edilir, böylece trigger sonrası tutarlılık denetlenir.
drop policy if exists appointments_insert_policy on public.appointments;
create policy appointments_insert_policy
    on public.appointments
    for insert
    to authenticated
    with check (
        student_id = auth.uid()
        and exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.role = 'student'
        )
    );

-- Güncelleme: öğrenci yalnızca kendi randevusunun status'ünü iptal edebilir;
-- öğretmen kendi öğrencisi için onay/iptal/tamamlandı yapabilir. Hangi alanların
-- değiştirilebileceği trigger ile sınırlandırılır (0003). Burada satır düzeyinde
-- erişim verilir; gerçek kısıtlar trigger + politikada yapılır.
drop policy if exists appointments_update_policy on public.appointments;
create policy appointments_update_policy
    on public.appointments
    for update
    to authenticated
    using (student_id = auth.uid() or teacher_id = auth.uid())
    with check (student_id = auth.uid() or teacher_id = auth.uid());

-- Silme: öğrenci kendi randevusunu silebilir (yalnızca pending iken, trigger
-- ile kontrol edilir).
drop policy if exists appointments_delete_policy on public.appointments;
create policy appointments_delete_policy
    on public.appointments
    for delete
    to authenticated
    using (student_id = auth.uid());
