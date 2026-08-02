-- |--------------------------------------------------------------------------
-- Migration: 0016_teacher_students.sql
-- Açıklama:
--   Öğretmen–öğrenci atama ilişkisini tutan çapraz referans tablosu.
--   Mevcut profiles/appointments/availability yapılarına DOKUNULMAZ; yalnızca
--   yeni bir tablo + RLS politikaları eklenir.
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.profiles (id uuid, role text, is_active boolean)  -> halihazırda mevcut
--
-- Veri modeli notları:
--   - Bir satır = "bu öğretmen bu öğrenciyi listesine ekledi".
--   - Bir öğrenci birden fazla öğretmenle çalışabileceği için çoktan-çoğa
--     model: composite PK (teacher_id, student_id) aynı çifte ikinci kaydı
--     engeller.
--   - teacher_id / student_id silinirse ilişki kaydı CASCADE ile düşer.
--   - assigned_by silinirse SET NULL (geçmiş atamalar otoritesiz kalabilir
--     ama kaybolmaz).
--   - assigned_by opsiyoneldir; admin veya öğretmen tarafından atanabilir.
--   - UPDATE politikası YOKTUR: ilişki değişikliği sil+yeniden ekle ile
--     yapılmalıdır (kurallar gereği).
--
-- Güvenlik notları:
--   - RLS etkin; tüm yetkiler authenticated rolüne verilir.
--   - Admin: tüm satırlarda tam yetki (select/insert/delete) — RLS üzerinden.
--   - Aktif öğretmen (role='teacher' AND is_active=true):
--       SELECT -> yalnız teacher_id = auth.uid()
--       INSERT -> yalnız teacher_id = auth.uid() ve hem teacher hem de öğrenci
--                 aktif+rol doğrulaması (with check)
--       DELETE -> yalnız teacher_id = auth.uid()
--   - Öğrenci (role='student'):
--       SELECT -> yalnız student_id = auth.uid()
--       INSERT/UPDATE/DELETE -> yok (sadece okuma)
--   - INSERT WITH CHECK:
--       * teacher_id gerçekten aktif teacher rolünde olmalı
--       * student_id gerçekten aktif student rolünde olmalı
--       * teacher_id = auth.uid() (öğretmen yalnız kendi adına atama yapar)
--         admin ise bu koşul aranmaz (service_role veya admin RLS yoluyla).
--   - Mevcut hiçbir politika/trigger değiştirilmez; tek bir UPDATE policy
--     tanımlanmaz.
--   - Migration idempotent (drop policy if exists / create table if not exists
--     / create index if not exists).
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- A) Tablo
-- ===========================================================================
create table if not exists public.teacher_students (
    teacher_id uuid not null
        references public.profiles(id) on delete cascade,

    student_id uuid not null
        references public.profiles(id) on delete cascade,

    assigned_at timestamptz not null default now(),

    assigned_by uuid
        references public.profiles(id) on delete set null,

    -- Öğretmen ve öğrenci aynı kişi olamaz
    constraint teacher_students_teacher_student_diff_chk
        check (teacher_id <> student_id),

    -- Bir (teacher_id, student_id) çiftinden yalnızca bir tane olsun
    constraint teacher_students_pkey primary key (teacher_id, student_id)
);

-- ===========================================================================
-- B) İndksler (sorgu desenleri için)
-- ===========================================================================
-- Öğretmenin kendi öğrencilerini listelemesi (teacher_id eşitliği).
create index if not exists teacher_students_teacher_idx
    on public.teacher_students (teacher_id, assigned_at desc);

-- Öğrencinin hangi öğretmenlere bağlı olduğunu bulması.
create index if not exists teacher_students_student_idx
    on public.teacher_students (student_id, assigned_at desc);

-- assigned_by takibi (opsiyonel).
create index if not exists teacher_students_assigned_by_idx
    on public.teacher_students (assigned_by)
    where assigned_by is not null;

-- ===========================================================================
-- C) Row Level Security
-- ===========================================================================
alter table public.teacher_students enable row level security;

-- Yardımcı koşullar:
--   teacher_active        -> auth.uid() aktif bir teacher rolünde
--   student_active_self    -> satırdaki student_id aktif bir student rolünde
--   teacher_active_self    -> satırdaki teacher_id aktif bir teacher rolünde
--   admin_self             -> auth.uid() admin rolünde
-- (Mevcut profiles_read_policy üzerinden subquery erişimi güvenlidir: 0010
--  politikası herkesin kendi profilini okumasına zaten izin verir; admin
--  ise tüm profilleri görür.)

-- ---------------------------------------------------------------------------
-- C1) SELECT — okuma
-- ---------------------------------------------------------------------------
--   * Admin tüm kayıtları görür.
--   * Aktif öğretmen yalnızca teacher_id = auth.uid() olan kayıtları görür.
--   * Öğrenci yalnızca student_id = auth.uid() olan kayıtları görür.
-- ---------------------------------------------------------------------------
drop policy if exists teacher_students_read_policy on public.teacher_students;
create policy teacher_students_read_policy
    on public.teacher_students
    for select
    to authenticated
    using (
        -- Admin her şeyi görür
        exists (
            select 1 from public.profiles p
             where p.id = auth.uid()
               and p.role = 'admin'
        )
        -- Aktif öğretmen kendi satırlarını görür
        or (
            teacher_id = auth.uid()
            and exists (
                select 1 from public.profiles p
                 where p.id = auth.uid()
                   and p.role = 'teacher'
                   and p.is_active = true
            )
        )
        -- Öğrenci kendi satırlarını görür
        or (
            student_id = auth.uid()
            and exists (
                select 1 from public.profiles p
                 where p.id = auth.uid()
                   and p.role = 'student'
                   and p.is_active = true
            )
        )
    );

-- ---------------------------------------------------------------------------
-- C2) INSERT — ekleme
-- ---------------------------------------------------------------------------
--   * Admin ekleyebilir. Adminin eklediği satırda teacher_id aktif teacher,
--     student_id aktif student olmalıdır. assigned_by admin tarafından serbest
--     bırakılır (admin kendini veya bir öğretmeni vb. atayabilir).
--   * Aktif öğretmen yalnızca kendi adına (teacher_id = auth.uid()) atama
--     yapabilir ve bu durumda assigned_by = auth.uid() olmalıdır.
--   * Öğrenci INSERT YAPAMAZ (koşullarda student rolü için dal yoktur).
-- ---------------------------------------------------------------------------
drop policy if exists teacher_students_insert_policy on public.teacher_students;
create policy teacher_students_insert_policy
    on public.teacher_students
    for insert
    to authenticated
    with check (
        -- teacher_id gerçekten aktif bir teacher olmalı
        exists (
            select 1 from public.profiles p
             where p.id = teacher_id
               and p.role = 'teacher'
               and p.is_active = true
        )
        -- student_id gerçekten aktif bir student olmalı
        and exists (
            select 1 from public.profiles p
             where p.id = student_id
               and p.role = 'student'
               and p.is_active = true
        )
        and (
            -- Admin: serbest — assigned_by herhangi bir kullanıcı olabilir
            -- (yukarıdaki rol/aktiflik denetimleri yine de geçerli)
            exists (
                select 1 from public.profiles p
                 where p.id = auth.uid()
                   and p.role = 'admin'
            )
            -- Öğretmen: yalnızca kendi adına atama yapabilir ve assigned_by
            -- kendi kimliği olmalı (başka kullanıcıyı assigned_by yazamaz)
            or (
                teacher_id = auth.uid()
                and assigned_by = auth.uid()
                and exists (
                    select 1 from public.profiles p
                     where p.id = auth.uid()
                       and p.role = 'teacher'
                       and p.is_active = true
                )
            )
        )
    );

-- ---------------------------------------------------------------------------
-- C3) DELETE — silme
-- ---------------------------------------------------------------------------
--   * Admin her satırı silebilir.
--   * Aktif öğretmen yalnızca teacher_id = auth.uid() olan satırı silebilir.
--   * Öğrenci SİLEMEZ (koşulda student rolü için dal yoktur).
-- ---------------------------------------------------------------------------
drop policy if exists teacher_students_delete_policy on public.teacher_students;
create policy teacher_students_delete_policy
    on public.teacher_students
    for delete
    to authenticated
    using (
        exists (
            select 1 from public.profiles p
             where p.id = auth.uid()
               and p.role = 'admin'
        )
        or (
            teacher_id = auth.uid()
            and exists (
                select 1 from public.profiles p
                 where p.id = auth.uid()
                   and p.role = 'teacher'
                   and p.is_active = true
            )
        )
    );

-- ---------------------------------------------------------------------------
-- C4) UPDATE politikası KASITLI OLARAK TANIMLANMAZ.
--     İlişki değişikliği "sil ve yeniden ekle" yoluyla yapılmalıdır
--     (kurallar gereği). RLS, UPDATE için hiçbir policy tanımlamadığından
--     authenticated rolüne update yetkisi otomatik olarak verilmez; tablo
--     yalnızca service_role (RLS bypass) üzerinden güncellenebilir, ki bu da
--     uygulama için stopwords değildir.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- D) GRANT — en az yetki prensibi
-- ===========================================================================
-- RLS etkin olduğu için GRANT yalnızca "RLS çerçevesi içinde" erişim verir;
-- raw tabloya doğrudan erişim vermez. authenticated'e select/insert/delete
-- verdik (update vermedik); tüm asıl yetki kısıtları yukarıdaki policy'lerde.
revoke all on public.teacher_students from public, anon, authenticated;

grant select on public.teacher_students to authenticated;
grant insert on public.teacher_students to authenticated;
grant delete on public.teacher_students to authenticated;
-- update kasıtlı olarak verilmedi (policy yok).
