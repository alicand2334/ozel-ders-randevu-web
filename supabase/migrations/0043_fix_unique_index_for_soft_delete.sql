-- |--------------------------------------------------------------------------
-- Migration: 0043_fix_unique_index_for_soft_delete.sql
-- Açıklama: availability_teacher_slot_uniq unique index'ini partial hale getir.
--           Sadece deleted_at IS NULL (aktif) kayıtlar için unique olsun.
--           Soft-delete edilmiş kayıtlar yeni kayıt engellemesin.
-- ---------------------------------------------------------------------------

-- Eski tam unique index'i kaldır
drop index if exists public.availability_teacher_slot_uniq;

-- Yeni partial unique index: sadece aktif (deleted_at IS NULL) kayıtlar için unique
create unique index if not exists availability_teacher_slot_uniq
    on public.availability (teacher_id, available_date, start_time, end_time)
    where deleted_at is null;