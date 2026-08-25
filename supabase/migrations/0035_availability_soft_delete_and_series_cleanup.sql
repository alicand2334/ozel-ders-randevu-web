-- |--------------------------------------------------------------------------
-- Migration: 0035_availability_soft_delete_and_series_cleanup.sql
-- Açıklama: Availability soft-delete desteği ekle ve series silme mantığını güncelle.
--           Sadece pending appointment'lar silinir, cancelled/completed korunur.
--           Availability fiziksel silinmez, deleted_at ile işaretlenir.
-- ---------------------------------------------------------------------------

-- 1. availability tablosuna deleted_at kolonu ekle
alter table public.availability
add column if not exists deleted_at timestamp with time zone;

-- İndeks: silinmemiş kayıtlar için sorguları hızlandır
create index if not exists idx_availability_deleted_at on public.availability (deleted_at)
where deleted_at is null;

-- 2. delete_availability_slot fonksiyonunu güncelle
create or replace function public.delete_availability_slot(
    p_slot_id uuid,
    p_teacher_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_appointment_count int;
    v_slot_exists boolean;
    v_pending_count int;
    v_already_deleted boolean;
begin
    -- Slot'ın bu öğretmene ait olduğunu kontrol et (soft-deleted dahil)
    select exists (
        select 1 from public.availability
        where id = p_slot_id and teacher_id = p_teacher_id
    ) into v_slot_exists;

    if not v_slot_exists then
        return jsonb_build_object(
            'success', false,
            'error', 'Müsaitlik bulunamadı veya bu öğretmene ait değil.',
            'error_code', 'NOT_FOUND'
        );
    end if;

    -- Zaten soft-deleted mi kontrol et
    select deleted_at is not null into v_already_deleted
    from public.availability
    where id = p_slot_id and teacher_id = p_teacher_id;

    if v_already_deleted then
        return jsonb_build_object(
            'success', true,
            'message', 'Bu müsaitlik zaten kaldırılmış.',
            'deleted_pending_appointments', 0
        );
    end if;

    -- Bu slot'a bağlı pending appointment var mı kontrol et
    select count(*) into v_pending_count
    from public.appointments
    where slot_id = p_slot_id
      and status = 'pending';

    -- Pending appointment'ları sil
    if v_pending_count > 0 then
        delete from public.appointments
        where slot_id = p_slot_id
          and status = 'pending';
    end if;

    -- Slot'u soft-delete et (deleted_at set et)
    update public.availability
    set deleted_at = now()
    where id = p_slot_id and teacher_id = p_teacher_id;

    return jsonb_build_object(
        'success', true,
        'message', 'Müsaitlik başarıyla silindi.',
        'deleted_pending_appointments', v_pending_count
    );
end;
$$;

-- 3. delete_availability_series fonksiyonunu güncelle
create or replace function public.delete_availability_series(
    p_series_id uuid,
    p_teacher_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_slots uuid[];
    v_slot uuid;
    v_pending_count int;
    v_total_pending int := 0;
    v_total_cancelled int := 0;
    v_total_completed int := 0;
    v_series_exists boolean;
begin
    -- Serinin bu öğretmene ait olduğunu kontrol et (soft-deleted dahil)
    select exists (
        select 1 from public.availability
        where series_id = p_series_id and teacher_id = p_teacher_id
    ) into v_series_exists;

    if not v_series_exists then
        return jsonb_build_object(
            'success', false,
            'error', 'Seri bulunamadı veya bu öğretmene ait değil.',
            'error_code', 'NOT_FOUND'
        );
    end if;

    -- Silinmemiş slotları al
    select array_agg(id) into v_slots
    from public.availability
    where series_id = p_series_id and teacher_id = p_teacher_id and deleted_at is null;

    -- Eğer silinmemiş slot yoksa (zaten tamamı silinmiş), idempotent başarı döndür
    if v_slots is null or array_length(v_slots, 1) = 0 then
        return jsonb_build_object(
            'success', true,
            'message', 'Bu haftalık seri zaten kaldırılmış.',
            'deleted_pending_appointments', 0,
            'preserved_cancelled', 0,
            'preserved_completed', 0,
            'deleted_slot_count', 0
        );
    end if;

    -- Her slot için appointment istatistiklerini topla
    foreach v_slot in array v_slots
    loop
        -- Pending sayısı
        select count(*) into v_pending_count
        from public.appointments
        where slot_id = v_slot
          and status = 'pending';

        if v_pending_count > 0 then
            v_total_pending := v_total_pending + v_pending_count;
        end if;

        -- Cancelled sayısı (sadece bilgi için - biriktir)
        select count(*) into v_pending_count
        from public.appointments
        where slot_id = v_slot
          and status = 'cancelled';

        v_total_cancelled := v_total_cancelled + v_pending_count;

        -- Completed sayısı (sadece bilgi için - biriktir)
        select count(*) into v_pending_count
        from public.appointments
        where slot_id = v_slot
          and status = 'completed';

        v_total_completed := v_total_completed + v_pending_count;
    end loop;

    -- Pending appointment'ları sil (tüm serideki slotlar için)
    if v_total_pending > 0 then
        delete from public.appointments
        where slot_id in (select unnest(v_slots))
          and status = 'pending';
    end if;

    -- Tüm seriyi soft-delete et
    update public.availability
    set deleted_at = now()
    where series_id = p_series_id and teacher_id = p_teacher_id;

    -- Mesaj oluştur
    if v_total_pending > 0 then
        return jsonb_build_object(
            'success', true,
            'message', 'Haftalık tekrar serisi ve ' || v_total_pending || ' onay bekleyen randevu silindi.',
            'deleted_pending_appointments', v_total_pending,
            'preserved_cancelled', v_total_cancelled,
            'preserved_completed', v_total_completed,
            'deleted_slot_count', array_length(v_slots, 1)
        );
    else
        return jsonb_build_object(
            'success', true,
            'message', 'Haftalık tekrar serisi başarıyla silindi.',
            'deleted_pending_appointments', 0,
            'preserved_cancelled', v_total_cancelled,
            'preserved_completed', v_total_completed,
            'deleted_slot_count', array_length(v_slots, 1)
        );
    end if;
end;
$$;

-- 4. Fonksiyonlara erişim yetkisi ver (idempotent)
grant execute on function public.delete_availability_slot(uuid, uuid) to authenticated;
grant execute on function public.delete_availability_series(uuid, uuid) to authenticated;

-- 5. Sync availability status fonksiyonunu da güncelle - deleted_at filtresi ekle
-- Bu fonksiyon availability status'unu appointments'a göre güncelliyor
-- Silinmiş availability'leri işleme almayacak
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

-- Trigger zaten var (0003/0021/0026), create or replace function yeterli