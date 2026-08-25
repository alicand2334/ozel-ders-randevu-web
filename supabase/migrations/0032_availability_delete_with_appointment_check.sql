-- |--------------------------------------------------------------------------
-- Migration: 0032_availability_delete_with_appointment_check.sql
-- Açıklama: Availability silmeden önce appointment kontrolü yapan atomik RPC fonksiyonu.
--           Foreign key constraint (ON DELETE RESTRICT) korunur, veri bütünlüğü sağlanır.
-- ---------------------------------------------------------------------------

-- Tek slot silme fonksiyonu
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
begin
    -- Slot'ın bu öğretmene ait olduğunu kontrol et
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

    -- Bu slot'a bağlı appointment var mı kontrol et
    select count(*) into v_appointment_count
    from public.appointments
    where slot_id = p_slot_id;

    if v_appointment_count > 0 then
        return jsonb_build_object(
            'success', false,
            'error', 'Bu müsaitlik saatine bağlı ' || v_appointment_count || ' randevu bulunduğu için silinemez. Önce ilgili randevuları iptal edin.',
            'error_code', 'HAS_APPOINTMENTS',
            'appointment_count', v_appointment_count
        );
    end if;

    -- Appointment yoksa güvenle sil
    delete from public.availability
    where id = p_slot_id and teacher_id = p_teacher_id;

    return jsonb_build_object(
        'success', true,
        'message', 'Müsaitlik başarıyla silindi.'
    );
end;
$$;

-- Haftalık seri silme fonksiyonu
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
    v_slots_with_appointments uuid[];
    v_slot uuid;
    v_appointment_count int;
    v_total_appointments int := 0;
    v_date text;
begin
    -- Serinin bu öğretmene ait olduğunu ve slotlarını al
    select array_agg(id) into v_slots
    from public.availability
    where series_id = p_series_id and teacher_id = p_teacher_id;

    if v_slots is null or array_length(v_slots, 1) = 0 then
        return jsonb_build_object(
            'success', false,
            'error', 'Seri bulunamadı veya bu öğretmene ait değil.',
            'error_code', 'NOT_FOUND'
        );
    end if;

    -- Her slot için appointment kontrolü
    foreach v_slot in array v_slots
    loop
        select count(*) into v_appointment_count
        from public.appointments
        where slot_id = v_slot;

        if v_appointment_count > 0 then
            v_slots_with_appointments := array_append(v_slots_with_appointments, v_slot);
            v_total_appointments := v_total_appointments + v_appointment_count;

            -- Tarih bilgisini al
            select available_date into v_date
            from public.availability
            where id = v_slot;
        end if;
    end loop;

    -- Eğer herhangi bir slot'ta appointment varsa engelle
    if v_total_appointments > 0 then
        return jsonb_build_object(
            'success', false,
            'error', 'Bu haftalık serinin ' || array_length(v_slots_with_appointments, 1) || ' slotunda toplam ' || v_total_appointments || ' randevu bulunduğu için silinemez. Önce ilgili randevuları iptal edin.',
            'error_code', 'HAS_APPOINTMENTS',
            'appointment_count', v_total_appointments,
            'affected_slot_count', array_length(v_slots_with_appointments, 1)
        );
    end if;

    -- Hiçbir slot'ta appointment yoksa seriyi güvenle sil
    delete from public.availability
    where series_id = p_series_id and teacher_id = p_teacher_id;

    return jsonb_build_object(
        'success', true,
        'message', 'Haftalık tekrar serisi başarıyla silindi.',
        'deleted_count', array_length(v_slots, 1)
    );
end;
$$;

-- Fonksiyonlara erişim yetkisi ver
grant execute on function public.delete_availability_slot(uuid, uuid) to authenticated;
grant execute on function public.delete_availability_series(uuid, uuid) to authenticated;