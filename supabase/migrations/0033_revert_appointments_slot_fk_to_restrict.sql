-- |--------------------------------------------------------------------------
-- Migration: 0033_revert_appointments_slot_fk_to_restrict.sql
-- Açıklama: appointments.slot_id FK'sını ON DELETE RESTRICT (varsayılan) olarak geri al.
--           0031 migration CASCADE eklemişti; randevular yanlışlıkla silinmesin.
-- ---------------------------------------------------------------------------

-- Mevcut FK constraint'i kaldır (CASCADE olanı)
alter table public.appointments
drop constraint if exists appointments_slot_id_fkey;

-- Yeni FK constraint ekle: ON DELETE RESTRICT (varsayılan)
alter table public.appointments
add constraint appointments_slot_id_fkey
foreign key (slot_id)
references public.availability(id)
on delete restrict;

-- Not: RESTRICT (veya NO ACTION) varsayılandır; müsaitlik silinirken bağlı
-- randevu varsa hata verir. RPC fonksiyonları (0032) önceden kontrol edip
-- kullanıcıya anlaşılır mesaj gösterir.