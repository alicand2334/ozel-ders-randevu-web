-- |--------------------------------------------------------------------------
-- Migration: 0022_teacher_profiles_durations_view.sql
-- Açıklama:
--   public.get_teacher_profiles() fonksiyonunu ve public.public_teacher_profiles
--   view'ini, 0017'de profiles tablosuna eklenen öğretmen süre ayarları
--   alanlarını dönecek şekilde genişletir:
--     - lesson_duration_minutes  (integer NOT NULL, 0017 DEFAULT 40)
--     - lesson_break_minutes      (integer NOT NULL, 0017 DEFAULT 10)
--     - student_buffer_minutes    (integer NOT NULL, 0017 DEFAULT 10)
--
--   Bu alanlar öğrencilerin randevu ekranında ders sayısına göre uygun
--   başlangıç saati adaylarını hesaplaması için gerekir. Öğretmenin
--   profiles tablosu RLS ile öğrenciye kapalıdır (id = auth.uid()); bu
--   yüzden erişim SECURITY DEFINER fonksiyon üzerinden güvenli projeksiyon
--   ile verilir. phone bilgisi KESİNLİKLE açılmaz (0003/0011 güvenlik
--   politikası korunur).
--
--   Bu migration 0021_appointments_flexible_booking.sql'den BAĞIMSIZDIR.
--   Sıralama planı: 0022 önce uygulanır, sonra öğrenci rezervasyon ekranı
--   (frontend) bu alanları kullanacak şekilde yeniden tasarlanır, en son
--   0021 SQL tarafı etkinleştirilir. 0022 yalnızca veriyi açar —
--   trigger/RLS/çakışma mantığına dokunmaz.
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.profiles
--     - id, full_name, role, created_at, is_active, avatar_url, bio,
--       specialization (0003 / 0011)
--     - lesson_duration_minutes, lesson_break_minutes,
--       student_buffer_minutes (0017) — NOT NULL DEFAULT
--   public.get_teacher_profiles()        (0003 / 0011) -> üzerine yazılır
--   public.public_teacher_profiles view  (0003 / 0011) -> yeniden tanımlanır
--
-- Güvenlik notları:
--   * Fonksiyon SECURITY DEFINER + search_path = public, pg_temp (0011 deseni
--     korunur) — RLS'i güvenli şekilde bypass eder; phone DAHİL DEĞİL.
--   * Yeni 3 alan öğrenciye açık olmalı (randevu akışında uygun başlangıç
--     saati hesabı için). Bunlar hassas bilgi DEĞİLDİR: ders süreleri ve
--     molalar zaten öğretmenin public profilinin bir parçasıdır.
--   * student_buffer_minutes, çakışma matematiğinde kullanılır — öğrenciye
--     gösterilmesi, başka bir öğrencinin bu öğretmenin ne zaman müsait
--     olacağını öngörmesini sağlar. Kabul edilebilir bilgi sızıntısı; zaten
--     availability tablosu de authenticated'a okuma politikasıyla açık.
--   * phone, email, auth.users ile ilgili hiçbir alan AÇILMAZ.
--   * Migration yapısı: PostgreSQL, RETURNS TABLE imzası değiştiğinde
--     CREATE OR REPLACE FUNCTION'ı reddeder (42P13 — "cannot change
--     return type"). Bu yüzden bu migration şu sırayı izler:
--       1) DROP VIEW IF EXISTS public_teacher_profiles   (bağımlılık kaldır)
--       2) DROP FUNCTION IF EXISTS get_teacher_profiles (eski imza sil)
--       3) CREATE FUNCTION get_teacher_profiles()        (yeni 11 alan imzası)
--       4) REVOKE all from public; GRANT execute to authenticated
--       5) CREATE VIEW public_teacher_profiles          (fonksiyona select *)
--       6) GRANT select on public_teacher_profiles to authenticated
--   * View ve fonksiyon arasındaki kısa pencerede view yoktur — bu yüzden
--     migration'ın TEK transaction içinde çalışması zorunludur (Supabase
--     SQL Editor birlikte gönderilen script'leri tek transaction içinde
--     çalıştırır; başarısızlık durumunda tüm değişiklikler rollback olur).
--   * Idempotentlik: DROP ... IF EXISTS + CREATE (or replace değil) — tekrar
--     çalıştırılırsa view ve fonksiyon sırayla silinip yeniden kurulur;
--     var olmayan view/function silme IF EXISTS nedeniyle no-op'tur.
--   * Trigger'lara, RLS politikalarına, sync_availability_status'a,
--     appointments_insert_guard'a dokunulmaz.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- A) Önce bağımlı view'i güvenli şekilde kaldır
-- ===========================================================================
-- public_teacher_profiles view'i get_teacher_profiles() fonksiyonuna
-- bağımlıdır. PostgreSQL DROP FUNCTION bağımlı nesneleri otomatik
-- kaldırmaz; bu yüzden önce view'i koluyoruz, sonra fonksiyonu. Sıralama:
--   1) DROP VIEW IF EXISTS public_teacher_profiles
--   2) DROP FUNCTION IF EXISTS get_teacher_profiles
--   3) CREATE FUNCTION (yeni imza ile)
--   4) CREATE VIEW (fonksiyonun yeni kolonlarını devralır)
--   5) GRANT / REVOKE (yetkileri geri yükle)
-- ---------------------------------------------------------------------------
-- View'i kaybedeceğiz ama hemen sonraki adımda yeniden oluşturulacaktır;
-- arada kısa bir süre view yoktur (transaction içinde — bk. aşağıdaki not).
-- ---------------------------------------------------------------------------
drop view if exists public.public_teacher_profiles;

-- ===========================================================================
-- B) Eski fonksiyonu kaldır (imza değişikliği için zorunlu)
-- ===========================================================================
-- PostgreSQL: "cannot change return type of existing function" hatası
-- CREATE OR REPLACE üzerinde OUT parametre tipleri farklıysa fırlatılır
-- (42P13). Bu yüzden önce DROP FUNCTION yapmalıyız. View yukarıda
-- kaldırıldığı için DROP FUNCTION artık dependency hatası vermeyecek.
-- Idempotent: IF EXISTS kullanıldı.
-- ---------------------------------------------------------------------------
drop function if exists public.get_teacher_profiles();

-- ===========================================================================
-- C) Yeni get_teacher_profiles() — 3 yeni alan ekle (tam yeniden tanım)
-- ===========================================================================
-- Yeni imza (0011'in 8 alanına + 3 alan):
--   + lesson_duration_minutes integer
--   + lesson_break_minutes     integer
--   + student_buffer_minutes   integer
--
-- Fonksiyon gövdesi yalnızca 3 yeni kolonu SELECT'e ekler. Güvenlik modeli
-- (SECURITY DEFINER + search_path sabitleme + phone hariç) aynen korunur.
-- ---------------------------------------------------------------------------
create function public.get_teacher_profiles()
returns table (
    id                          uuid,
    full_name                   text,
    role                        text,
    created_at                  timestamptz,
    is_active                   boolean,
    avatar_url                  text,
    bio                         text,
    specialization              text,
    lesson_duration_minutes     integer,
    lesson_break_minutes        integer,
    student_buffer_minutes      integer
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
    select p.id,
           p.full_name,
           p.role,
           p.created_at,
           p.is_active,
           p.avatar_url,
           p.bio,
           p.specialization,
           p.lesson_duration_minutes,
           p.lesson_break_minutes,
           p.student_buffer_minutes
      from public.profiles p
     where p.role = 'teacher';
$$;

-- ---------------------------------------------------------------------------
-- C.b) Yetkilendirme — idempotent revoke/grant (0011 deseni)
-- ---------------------------------------------------------------------------
revoke all on function public.get_teacher_profiles() from public;
grant execute on function public.get_teacher_profiles() to authenticated;

-- ===========================================================================
-- D) public_teacher_profiles view — yeniden oluştur (üzerine yeni kolonları
--    devralacak şekilde). Fonksiyonunun döndürdüğü tüm kolonları içerecek.
-- ---------------------------------------------------------------------------
create view public.public_teacher_profiles as
    select * from public.get_teacher_profiles();

grant select on public.public_teacher_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Korunan unsurlar (dokunulmadı):
--   * RLS politikaları (profiles_read_policy / profiles_update_policy) (0003)
--   * profiles_before_update_guard_trg (0003/0010)
--   * appointments_insert_guard / appointments_update_guard / delete_guard
--   * sync_availability_status (0003/0005) — 0021'de güncellenecek
--   * appointments_active_slot_uniq (0002:62) — 0021'de kaldırılacak
--   * notifications trigger (0008)
--   * handle_new_user trigger (0003)
-- ---------------------------------------------------------------------------
