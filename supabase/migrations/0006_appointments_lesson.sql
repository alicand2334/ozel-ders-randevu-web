-- |--------------------------------------------------------------------------
-- Migration: 0006_appointments_lesson.sql
-- Açıklama: appointments tablosuna ders bilgisini saklamak için "lesson" kolonu
--           eklenir. Mevcut subject (Ders Konusu) ve notes alanları aynen kalır.
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.appointments (0002_appointments.sql) -> var
--
-- Veri modeli notları:
--   - lesson: Öğrencinin randevu aşamasında seçtiği ders (Matematik, Fizik...).
--   - Nullable bırakılır; böylece mevcut (eski) randevu kayıtları bozulmaz.
--   - subject alanı serbest metin "Ders Konusu" olarak korunur; lesson ile
--     ayrı bir bilgidir.
--   - Indeks, trigger, RLS veya policy değişikliği yapılmaz.
-- ---------------------------------------------------------------------------

alter table public.appointments
    add column if not exists lesson text;
