-- |--------------------------------------------------------------------------
-- Migration: 0010_admin_role.sql
-- Açıklama:
--   A) profiles.role alanına 'admin' değerini destekleyecek CHECK constraint ekle.
--   B) profiles_before_update_guard() fonksiyonunu yeniden tanımla:
--      - Normal kullanıcı (RLS bağlamında auth.uid()) role'ü DEĞİŞTİREMEZ (mevcut davranış).
--      - service_role / SQL Editor bağlamında (auth.uid() NULL) role DEĞİŞTİRİLEBİLİR.
--      Bu, server-side API (service_role client) üzerinden adminin rol atamasına olanak
--      tanır; istemci bağlamında role hâlâ immutable kalır.
--   C) profiles SELECT/UPDATE RLS politikalarına 'admin' koşulu ekle (admin tüm
--      profilleri görür, ancak RLS üzerinden herhangi bir satırı update edemez;
--      admin güncellemeleri yalnızca service_role API üzerinden yapılır — RLS bypass).
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.profiles                           -> halihazırda oluşturuldu
--   public.profiles_before_update_guard()     -> 0003_triggers_functions.sql
--   mevcut profiles_read_policy / _update_     -> 0003
--
-- Güvenlik notları:
--   - CHECK constraint mevcut 'student' / 'teacher' verilerini bozmaz; yalnızca
--     ileride eklenecek 'admin' değerine izin verir.
--   - Trigger fonksiyonu gövdesi, auth.uid() NULL ise role değişikliğine izin verir.
--     Supabase service_role bağlamında auth.uid() NULL döner; normal authenticated
--     oturumlarında dolu olur. Dolayısıyla normal kullanıcılar role değiştiremez,
--     service_role (server-side API) değiştirebilir.
--   - RLS: admin eklerinASIL `or` ile genişletilir; mevcut `id = auth.uid()`
--     koşulları korunur. UPDATE policy yalnızca satır sahibi için kullanılır
--     (kendi full_name/phone güncelleme); admin update'leri service_role üzerinden
--     RLS bypass yapar — policy genişletmesine gerek yoktur.
--   - Migration idempotent (drop if exists / create or replace / drop constraint
--     if exists).
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- A) profiles.role CHECK constraint ('admin' desteği)
-- ===========================================================================
-- Mevcut role alanı serbest text. Eğer önceki bir migration'da constraint
-- yoksa güvenli şekilde eklenir; varsa idempotent olarak yeniden eklenir.
alter table public.profiles
    drop constraint if exists profiles_role_chk;

alter table public.profiles
    add constraint profiles_role_chk
    check (role in ('student', 'teacher', 'admin'));

-- ===========================================================================
-- B) profiles_before_update_guard() — service_role override'ı
-- ===========================================================================
-- Yeniden tanım: auth.uid() NULL ise (service_role bağlamı) role değişikliği
-- kabul edilir; aksi halde (normal kullanıcı) role immutable + updated_at otomatik.
-- Bu davranış 0003'teki orijinal guard'ı genişletir; mevcut kullanıcı deneyimi
-- değişmez (yalnızca service_role bağlamında yeni bir istisna yok).
create or replace function public.profiles_before_update_guard()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();

    -- role değişimi: yalnızca service_role bağlamında (auth.uid() NULL) izinli.
    -- Normal authenticated kullanıcı (auth.uid() dolu) role'L değiştiremez.
    if new.role is distinct from old.role then
        if auth.uid() is not null then
            raise exception 'Profil rolü bu işlemle değiştirilemez. Yalnızca yönetici (server-side API) üzerinden atanabilir.'
                using errcode = 'P0003';
        end if;
        -- service_role: role değişikliğine izin ver; başka kontrol yok.
        -- Yeni değer CHECK constraint tarafından doğrulanır.
    end if;

    -- id, created_at kullanıcı tarafından değiştirilemez (PK / sabit).
    -- full_name / phone serbest. updated_at yukarıda set edildi.
    return new;
end;
$$;

-- Trigger mevcut (0003:367); fonksiyon gövdesi REPLACE ile güncellendiği için
-- trigger'ı bırakılır, yeniden oluşturmaya gerek yoktur.

-- ===========================================================================
-- C) profiles RLS — admin SELECT genişletmesi
-- ===========================================================================
-- Mevcut policy (0003:79):
--   using (id = auth.uid())
-- Yeniden tanım: admin kartınını tüm profilleri görebiir. UPDATE policy
-- değiştirilmez (admin update yine service_role üzerinden RLS bypass yapar).
drop policy if exists profiles_read_policy on public.profiles;
create policy profiles_read_policy
    on public.profiles
    for select
    to authenticated
    using (
        id = auth.uid()
        or exists (
            select 1 from public.profiles p2
             where p2.id = auth.uid()
               and p2.role = 'admin'
        )
    );

-- mevcut profiles_update_policy (0003:88) korundu: yalnızca satır sahibi kendi
-- full_name/phone günceller. Adminin RLS üzerinden update'i gerekmez; server-side
-- service_role API zaten RLS'den muaftır.

-- ===========================================================================
-- D) appointments SELECT — admin tüm randevuları görür
-- ===========================================================================
drop policy if exists appointments_read_policy on public.appointments;
create policy appointments_read_policy
    on public.appointments
    for select
    to authenticated
    using (
        student_id = auth.uid()
        or teacher_id = auth.uid()
        or exists (
            select 1 from public.profiles p
             where p.id = auth.uid()
               and p.role = 'admin'
        )
    );

-- ===========================================================================
-- E) notifications SELECT — admin tüm bildirimleri görür
-- ===========================================================================
drop policy if exists notifications_read_policy on public.notifications;
create policy notifications_read_policy
    on public.notifications
    for select
    to authenticated
    using (
        recipient_id = auth.uid()
        or exists (
            select 1 from public.profiles p
             where p.id = auth.uid()
               and p.role = 'admin'
        )
    );

-- ===========================================================================
-- F) availability SELECT — admin tüm slotları görür
-- ===========================================================================
-- Mevcut policy (0001:56) `using (true)` (tüm authenticated kullanıcılar).
-- Admin için ek bir koşul gerekmez; mevcut policy yeterli. Yine de açıklama:
-- availability zaten tüm authenticated kullanıcılara açık.
-- ===========================================================================
