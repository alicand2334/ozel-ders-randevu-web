-- |--------------------------------------------------------------------------
-- Migration: 0036_fix_availability_past_date_check_for_soft_delete.sql
-- Açıklama: availability_no_past_date_chk constraint'ini güncelle ki deleted_at
--           set edilirse past date kontrolünü atla.
-- ---------------------------------------------------------------------------

-- Mevcut constraint'i kaldır
alter table public.availability
drop constraint if exists availability_no_past_date_chk;

-- Yeni constraint: past date kontrolü SİLİNMEMİŞ kayıtlar için geçerli
-- deleted_at doluysa (yani soft-delete edilmişse) past date kontrolü yapma
alter table public.availability
add constraint availability_no_past_date_chk
check (
    deleted_at is not null
    or available_date >= (now() at time zone 'Europe/Istanbul')::date
) not valid;

-- Not: NOT VALID demek, mevcut veriyi validate etmez. Sadece yeni INSERT/UPDATE'lerde kontrol edilir.
-- Bu sayede geçmiş tarihli silinmiş kayıtlar sorun yaratmaz.