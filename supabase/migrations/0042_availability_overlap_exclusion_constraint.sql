-- |--------------------------------------------------------------------------
-- Migration: 0042_availability_overlap_exclusion_constraint.sql
-- Açıklama: Bu migration boş bırakıldı. Exclusion constraint approach
--           immutable function sorunu nedeniyle kullanılamıyor.
--           Çakışma kontrolü şu yollarla yapılıyor:
--           1. Partial unique index (0043) - aynı tarih/saat için duplicate engelleme
--           2. Frontend/InnerPanel.tsx - application-level overlap checking
-- ---------------------------------------------------------------------------

-- No-op migration to keep numbering
select 1;