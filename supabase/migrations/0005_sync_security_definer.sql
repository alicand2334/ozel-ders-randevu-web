-- |--------------------------------------------------------------------------
-- Migration: 0005_sync_security_definer.sql
-- Açıklama:
--   public.sync_availability_status() fonksiyonunu SECURITY DEFINER yapar.
--
-- Gerekçe:
--   Fonksiyon daha önce SECURITY INVOKER olarak çalışıyordu. appointments INSERT
--  .policy'si öğrenci rolüne izin verse de, AFTER INSERT trigger'ı çağrılan
--   sync_availability_status() içinde availability tablosunda UPDATE yapılıyor.
--   availability_update_policy USING/WITH CHECK koşulu `teacher_id = auth.uid()`
--   olduğundan, auth.uid() öğrenci id'sine eşit olduğunda UPDATE 0 satır etkiler
--   ve slot 'open' durumda kalır.
--
--   SECURITY DEFINER + sabit search_path ile fonksiyon, çağıranın yetkileri
--   yerine fonksiyon sahibinin (postgres) yetkileriyle çalışır; RLS policy'sini
--   güvenli şekilde bypass ederek ilgili availability satırını 'booked' olarak
--   günceller. Gövde değiştirilmedi; yalnızca security bağlamı ve search_path
--   eklendi.
--
-- Güvenlik notları:
--   - search_path = public, pg_temp olarak sabitlendi; şema enjeksiyonu önlenir.
--   - Fonksiyon gövdesi Migration 0003'ten birebir alındı; tek kelime
--     değiştirilmedi.
--   - Trigger'lar, policy'ler, tablolar, diğer fonksiyonlar değiştirilmedi.
--   - Fonksiyon sahibi değiştirilmedi (postgres olarak kalır).
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Önkoşul: 0003_triggers_functions.sql çalıştırılmış olmalı.
-- Bu migration yalnızca public.sync_availability_status() fonksiyonunu
-- yeniden tanımlar; bağımlı tüm trigger'lar otomatik olarak yeni
-- fonksiyon gövdesini kullanmaya devam eder (DROP/RECREATE gerekmez).
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
begin
    if TG_OP = 'INSERT' then
        update public.availability
           set status = 'booked'
         where id = new.slot_id;
        return new;
    end if;

    if TG_OP = 'UPDATE' then
        if new.status in ('confirmed','completed') then
            update public.availability
               set status = 'booked'
             where id = new.slot_id;
        elsif new.status = 'cancelled' then
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

-- ---------------------------------------------------------------------------
-- (Opsiyonel) Fonksiyon sahibini kesinleştir.
-- Genellikle migration'ı çalıştıran kullanıcı (postgres) sahibi olur.
-- Aşağıdaki satır yorumda bırakılmıştır; gerekirse açın:
-- alter function public.sync_availability_status() owner to postgres;
-- ---------------------------------------------------------------------------
