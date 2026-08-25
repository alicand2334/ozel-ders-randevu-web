-- |--------------------------------------------------------------------------
-- Migration: 0031_appointments_slot_fk_cascade.sql
-- Açıklama: appointments.slot_id FK'sını ON DELETE CASCADE olarak güncelle.
--           Müsaitlik slotu silindiğinde bağlı randevular da otomatik silinsin.
-- ---------------------------------------------------------------------------

-- Mevcut FK constraint'i kaldır
alter table public.appointments
drop constraint if exists appointments_slot_id_fkey;

-- Yeni FK constraint ekle: ON DELETE CASCADE
alter table public.appointments
add constraint appointments_slot_id_fkey
foreign key (slot_id)
references public.availability(id)
on delete cascade;

-- Not: slot_id NOT NULL olduğu için ON DELETE SET NULL kullanılamaz.
-- CASCADE en uygun seçenektir: müsaitlik silindiğinde randevular da silinir.