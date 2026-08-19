-- |--------------------------------------------------------------------------
-- | Migration: 0029_add_due_time_to_homework.sql
-- | Açıklama:
-- |   homework tablosuna nullable due_time TIME kolonu ekler.
-- |   Bu, due_date DATE ile birlikte saat bilgisini saklamak için kullanılır.
-- |--------------------------------------------------------------------------

-- ===========================================================================
-- A) Sütun ekle
-- ===========================================================================
alter table public.homework
add column if not exists due_time time null;