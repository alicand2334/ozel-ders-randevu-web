-- |--------------------------------------------------------------------------
-- Migration: 0023_availability_no_past_insert.sql
-- Açıklama:
--   public.availability tablosuna PostgreSQL CHECK constraint ekler. Amaç:
--   geçmiş tarihli (available_date < bugun) YENI availability satırı
--   eklenmesini veritabanı seviyesinde engellemek. Bu, yalnızca istemci
--   tarafındaki UI kontrolune güvenmemek içindir; RLS / service-role /
--   doğrudan DB erişimi dahil her INSERT yolunda çalışır.
--
--   Knut technician notu: Bu kısıt YALNIZCA yeni satırlar için geçerlidir
--   (CHECK constraint, satır eklendiğinde değerlendirilir). Mevcut geçmiş
--   satırlar (cron temizliği bekleyenler) bu kısıttan muaftir — geçmişe
--   dönük veriyi bozmamak için constraint `NOT VALID` ile eklenir; yani
--   var olan satırlar doğrulanmaz, yalnızca yeni INSERT/UPDATE'lerde
--   çalışır. Bu, cron (0023 kod route) geçmiş satırları silene kadar
--   migration'ın fail olmamasını sağlar.
--
--   Zaman dilimi: Europe/Istanbul. PostgreSQL `now() at time zone
--   'Europe/Istanbul'` bize İstanbul'daki anlık timestamptz verir;
--   `::date` dönüşümü İstanbul takvim gününü (YYYY-MM-DD) döndürür.
--   Böylece Vercel cron UTC'de çalışsa da DB seviyesindeki kısıt İstanbul
--   günü esas alır.
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.availability (0001 / 0018)  -> mevcut
--
-- Güvenlik notları:
--   * CHECK constraint RLS'den BAĞIMSIZ çalışır — service-role client
--     (RLS bypass) dahil herhangi bir INSERT/UPDATE yolunda değerlendirilir.
--     Bu yüzden geçmiş-tarih engeli için CHECK constraint seçildi; RLS
--     `with check` politikası service-role için geçersiz kalır.
--   * `NOT VALID` ile eklendiğinden mevcut satırlar doğrulanmaz; migration
--     mevcut veriyi bozulmadan geçer.
--   * RLS politikalarına, trigger'lara, indekslere, FK'lara DOKUNULMAZ.
--   * Migration idempotent (DO $$ ile constraint varlık kontrolü).
--   * HİÇBİR DROP yok. HİÇBİR veri silinmez/değiştirilmez.
-- ---------------------------------------------------------------------------
--
-- NedenBuSaatKontrol:
--   `now() at time zone 'Europe/Istanbul'`:
--     now() -> timestamptz (UTC, sunucu saati)
--     `at time zone 'Europe/Istanbul'` -> Türkiye saatine çevrilmiş timestamp
--     `::date` -> YYYY-MM-DD (İstanbul takvim günü)
--   available_date date tipindedir; karşılaştırma date = date.
--   Kısıt: available_date >= (bugun İstanbul).
--     - available_date == bugun: Kabul (bugunku slot eklenebilir).
--     - available_date >  bugun: Kabul (gelecek).
--     - available_date <  bugun: Red (geçmiş — yeni oluşturulamaz).
-- ---------------------------------------------------------------------------

do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conname = 'availability_no_past_date_chk'
           and conrelid = 'public.availability'::regclass
    ) then
        alter table public.availability
            add constraint availability_no_past_date_chk
            check (
                available_date >=
                ((now() at time zone 'Europe/Istanbul')::date)
            ) not valid;
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- Korunan unsurlar (dokunulmadı):
--   * availability_read/insert/update/delete_policy (0001)
--   * availability_insert_policy'nin `with check` kısı (0001:68) — bu
--     migration RLS politika değiştirmez; CHECK constraint RLS'den bağımsız
--     çalışır ve geçmiş tarihli insert'i ek kısıtlar.
--   * availability_set_updated_at trigger (0003)
--   * availability_teacher_slot_uniq (0001:38)
--   * availability_series_date_uniq (0018:134)
--   * availability_recurrence_*_chk (0018:98, 0018:117)
--   * appointments.slot_id FK on delete restrict (0002:23)
--   * appointments_insert_guard / sync_availability_status (0015/0021)
--   * availability_effective view (0022)
-- ---------------------------------------------------------------------------
