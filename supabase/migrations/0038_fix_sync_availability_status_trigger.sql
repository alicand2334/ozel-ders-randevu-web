-- |--------------------------------------------------------------------------
-- Migration: 0038_fix_sync_availability_status_trigger.sql
-- Açıklama: sync_availability_status trigger fonksiyonunu düzelt.
--           appointments tablosunda trigger tetiklendiğinde availability
--           tablosundaki deleted_at kontrolü yapılmalı.
-- ---------------------------------------------------------------------------

create or replace function public.sync_availability_status()
returns trigger
language plpgsql
security definer
as $$
declare
    v_avail_deleted_at timestamptz;
begin
    -- Silinmiş availability'leri işleme alma (slot_id üzerinden availability'yi kontrol et)
    select deleted_at into v_avail_deleted_at
    from public.availability
    where id = new.slot_id;

    if v_avail_deleted_at is not null then
        return new;
    end if;

    -- Mevcut logic aynen kalsın
    if tg_op = 'INSERT' then
        if exists (
            select 1 from public.appointments
            where slot_id = new.slot_id
              and status in ('pending', 'confirmed')
        ) then
            update public.availability
            set status = 'booked', updated_at = now()
            where id = new.slot_id;
        end if;
    elsif tg_op = 'UPDATE' then
        if exists (
            select 1 from public.appointments
            where slot_id = new.slot_id
              and status in ('pending', 'confirmed')
        ) then
            update public.availability
            set status = 'booked', updated_at = now()
            where id = new.slot_id;
        else
            update public.availability
            set status = 'open', updated_at = now()
            where id = new.slot_id;
        end if;
    elsif tg_op = 'DELETE' then
        if not exists (
            select 1 from public.appointments
            where slot_id = old.slot_id
              and status in ('pending', 'confirmed')
        ) then
            update public.availability
            set status = 'open', updated_at = now()
            where id = old.slot_id;
        end if;
    end if;

    return new;
end;
$$;