-- |--------------------------------------------------------------------------
-- Migration: 0040_fix_appointments_delete_guard_v2.sql
-- Açıklama: appointments_delete_guard fonksiyonunu düzelt - appointments.teacher_id kullan.
-- ---------------------------------------------------------------------------

create or replace function public.appointments_delete_guard()
returns trigger
language plpgsql
security invoker
as $$
declare
    v_actor uuid := auth.uid();
begin
    -- Yalnızca GERÇEK Supabase service_role Postgres rolü bypass alır.
    if current_user = 'service_role' then
        return old;
    end if;

    -- Öğretmen kendi availability'sindeki pending randevuları silebilmeli
    -- appointments.teacher_id kolonu kullanılabilir (availability lookup gerekmez)
    if v_actor = old.teacher_id and old.status = 'pending' then
        return old;
    end if;

    -- Aksi halde mevcut davranış: sadece öğrenci kendi pending randevusunu silebilir
    if v_actor is null or v_actor <> old.student_id then
        raise exception 'Bu randevuyu silme yetkiniz yok.'
            using errcode = '42501';
    end if;
    if old.status <> 'pending' then
        raise exception 'Yalnızca beklemede (pending) olan randevular silinebilir. İptal etmek için durumunu ''cancelled'' yapın.'
            using errcode = 'P0003';
    end if;
    return old;
end;
$$;