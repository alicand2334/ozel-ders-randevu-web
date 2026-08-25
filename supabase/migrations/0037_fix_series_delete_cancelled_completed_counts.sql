-- |--------------------------------------------------------------------------
-- Migration: 0037_fix_series_delete_cancelled_completed_counts.sql
-- Açıklama: delete_availability_series fonksiyonunda cancelled ve completed
--           appointment sayılarının doğru birikmesini sağla.
-- ---------------------------------------------------------------------------

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
begin
    -- Serinin bu öğretmene ait olduğunu ve silinmemiş slotlarını al
    select array_agg(id) into v_slots
    from public.availability
    where series_id = p_series_id and teacher_id = p_teacher_id and deleted_at is null;

    if v_slots is null or array_length(v_slots, 1) = 0 then
        return jsonb_build_object(
            'success', false,
            'error', 'Seri bulunamadı, bu öğretmene ait değil veya zaten silinmiş.',
            'error_code', 'NOT_FOUND'
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

grant execute on function public.delete_availability_series(uuid, uuid) to authenticated;