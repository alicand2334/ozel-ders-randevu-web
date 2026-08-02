-- |--------------------------------------------------------------------------
-- Migration: 0013_profiles_role_check_rebuild.sql
-- Açıklama:
--   profiles.role CHECK constraint'ini güvenli şekilde yeniden oluşturur.
--   Önce mevcut tüm ad varyantları (profiles_role_chk, profiles_role_check)
--   drop edilir, ardından tek bir constraint 'admin' rolünü de içerecek
--   şekilde yeniden tanımlanır.
--
-- Güvenlik notları:
--   - Yalnızca CHECK constraint ile ilgilenilir; RLS, trigger veya başka
--     bir tablo değiştirilmez.
--   - Mevcut 'student' / 'teacher' / 'admin' verileri yeni constraint'i
--     sağlar; bozulma olmaz.
--   - Migration idempotent (drop constraint if exists + add constraint).
-- ---------------------------------------------------------------------------

-- 1) Mevcut constraint ad varyantlarını güvenle kaldır.
alter table public.profiles
    drop constraint if exists profiles_role_chk;

alter table public.profiles
    drop constraint if exists profiles_role_check;

-- 2) Yeni constraint: izin verilen roller.
alter table public.profiles
    add constraint profiles_role_chk
    check (role in ('student', 'teacher', 'admin'));
