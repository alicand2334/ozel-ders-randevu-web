-- |--------------------------------------------------------------------------
-- Migration: 0026_sync_availability_skip_past_date_on_delete.sql
-- Açıklama:
--   public.sync_availability_status() trigger fonksiyonunun yalnızca DELETE
--   dalını günceller: bağlı availability satırının available_date değeri
--   Europe/Istanbul tarihine göre GEÇMİŞTE ise status='open' UPDATE'i
--   çalıştırılmadan fonksiyon return old ile çıkar. Gelecekteki slotlarda
--   mevcut DELETE → open davranışı birebir korunur.
--
--   Sorun:
--     Admin panelinden bir öğretmen kalıcı olarak silinirken appointments
--     tablosundan o öğretmene ait geçmiş (completed/cancelled) randevular
--     silinir. Her DELETE, appointments_sync_availability_ad AFTER DELETE
--     trigger'ı (0003:410) aracılığıyla sync_availability_status()
--     fonksiyonunun DELETE dalını (0021:541-553) tetikler.
--
--     Bu dal, slot'ta kalan pending/confirmed randevu kalmadıysa
--     `UPDATE public.availability SET status='open' WHERE id = v_slot`
--     çalıştırır. Ancak bu UPDATE, 0023'te tanımlanan CHECK constraint
--     `availability_no_past_date_chk` (available_date >= bugun Istanbul)
--     tarafindan doğrulanır. Constraint `NOT VALID` ile eklenmiş olsa da
--     `NOT VALID` yalnızca mevcut satırlar için muafiyet tanır; yeni
--     UPDATE'lerde tüm satırlar doğrulanır.
--
--     Geçmiş tarihli availability satırı UPDATE'e uğrayınca constraint
--     ihlali 23514 ("new row for relation 'availability' violates check
--     constraint availability_no_past_date_chk") fırlar ve silme akışı
--     "Öğretmen randevuları silinirken bir hata oluştu." ile durur.
--
--   Kök neden:
--     sync_availability_status() DELETE dalı, silinen öğretmenin profili
--     ve slotları birkaç adım sonra CASCADE ile zaten silinecek olan geçmiş
--     tarihli availability satırlarını gereksiz yere UPDATE edip 0023
--     CHECK constraint'ini ihlal ediyor. status='open' yapmanın bu yolda
--     hiçbir işlevsel değeri yoktur (geçmiş slot cron tarafından silinecektir).
--
--   Çözüm:
--     DELETE dalında, v_slot'a karşı availability satırının
--     available_date >= bugun (Istanbul) olup olmadığını kontrol et. Geçmişte
--     ise UPDATE'i atla ve return old. Gelecekteki slot davranışı birebir
--     korunur.
--
--   Güvenlik notları:
--     - Yalnızca sync_availability_status() fonksiyon gövdesi REPLACE edilir;
--       trigger'lar (appointments_sync_availability_ai/au/ad, 0003:398/403/410)
--       DOKUNULMAZ — create or replace function tetikleyicileri yeniden bağlar.
--     - INSERT dalı (0021:517-519), UPDATE dalı (0021:521-539) ve hata
--       dönüşleri birebir korunur. Bu migration yalnızca DELETE dalına yeni
--       bir geçmiş-tarih guard ekler.
--     - Normal öğrenci randevu iptali (AFTER UPDATE trigger, 0003:403 +
--       0021:521-539) DEĞİŞMEZ; slot cancel→open mantığı aynen çalışır.
--     - RLS politikaları, FK'ler, CHECK constraint'ler, diğer trigger'lar
--       (appointments_insert_guard_trg, appointments_update_guard_trg,
--        appointments_delete_guard_trg, notification trigger'ları) ve
--       0025 service_role bypass mantığı KORUNUR.
--     - SECURITY DEFINER + set search_path = public, pg_temp (0005/0021)
--       aynen korunur.
--     - Migration idempotent (create or replace function).
--     - Hiçbir veri silinmez/değiştirilmez. Hiçbir DROP yoktur.
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.sync_availability_status()              -> 0003/0005/0021
--   public.availability(available_date date)       -> 0001/0018
--   availability_no_past_date_chk CHECK constraint -> 0023
--   appointments_sync_availability_ad trigger      -> 0003:410 (korunur)
-- ---------------------------------------------------------------------------

create or replace function public.sync_availability_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_slot uuid;
    v_active_count int;
    v_slot_in_future boolean := false;
begin
    -- INSERT: esnek model — slot 'open' kalır (0021).
    if TG_OP = 'INSERT' then
        return new;
    end if;

    if TG_OP = 'UPDATE' then
        -- confirmed/completed: slot 'open' kalır. Yalnızca cancelled'da ve
        -- aktif randevu kalmadıysa 'open' (zaten 'open' → no-op).
        if new.status = 'cancelled' then
            select count(*) into v_active_count
              from public.appointments
             where slot_id = new.slot_id
               and status in ('pending','confirmed')
               and id <> new.id;
            if v_active_count = 0 then
                update public.availability
                   set status = 'open'
                 where id = new.slot_id;
            end if;
        end if;
        return new;
    end if;

    if TG_OP = 'DELETE' then
        v_slot := old.slot_id;

        -- 0026 koruması: Bağlı availability satırının available_date değeri
        -- Europe/Istanbul tarihine göre GEÇMİŞTE ise status='open' UPDATE'i
        -- atla. Geçmiş slot'ları 'open' yapmanın işlevsel değeri yoktur
        -- (cron silenecek) ve 0023 CHECK constraint'ini ihlal eder (23514).
        -- Gelecekteki slotlarda mevcut DELETE → open davranışı birebir
        -- korunur.
        select (available_date >= ((now() at time zone 'Europe/Istanbul')::date))
          into v_slot_in_future
          from public.availability
         where id = v_slot;

        if not v_slot_in_future then
            -- Geçmiş tarihli slot (veya satır bulunamadı): no-op.
            return old;
        end if;

        select count(*) into v_active_count
          from public.appointments
         where slot_id = v_slot
           and status in ('pending','confirmed');
        if v_active_count = 0 then
            update public.availability
               set status = 'open'
             where id = v_slot;
        end if;
        return old;
    end if;

    return null;
end;
$$;

-- Trigger'lar (appointments_sync_availability_ai/au/ad, 0003:398/403/410)
-- korunur; create or replace function yalnızca gövdeyi güncellediği için
-- trigger'ları yeniden oluşturmaya gerek yoktur.
