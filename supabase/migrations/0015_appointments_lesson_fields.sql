-- |--------------------------------------------------------------------------
-- Migration: 0015_appointments_lesson_fields.sql (REVIZE — mevcut veriyi korur)
-- Açıklama: appointments tablosuna ders paketi bilgilerini (ders sayısı,
--           ders/mola dakikası, başlangıç/bitiş anları) ekler; mevcut 4
--           kaydı güvenli şekilde backfill eder; sonra NOT NULL zorlar ve
--           appointments_insert_guard fonksiyonunu yeni alanlara göre
--           günceller. RLS politikalarına dokunulmaz.
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.appointments (0002_appointments.sql)        -> var
--   public.availability  (0001_availability.sql)       -> var
--   public.appointments_insert_guard (0003_triggers_functions.sql) -> var
--
-- Türetme kuralları (mevcut 4 kayıt için):
--   start_at = availability.available_date::timestamp + availability.start_time
--   end_at   = availability.available_date::timestamp + availability.end_time
--     -> Eski kayıtlar tek-derstir (lesson_count = 1) ve tek ders = 40 dk
--        molasızdır; ancak eski kayıtların gerçek slot bitişi availability'da
--        zaten tanımlı olduğundan, bitişi availability.end_time'dan alıp
--        tek ders için "toplam süre = 40 dk" varsayımıyla çelişmeyi,
--        veriyi değiştirmeksizin slot bitişine eşitliyoruz. lesson_count=1
--        için hesaplanan bitiş = start_at + 40 dk'dır; bu mevcut slot
--        bitişiyle uyumsuzsa bile mevcut kayıtların dokunulmazlığı tercih
--        edilir (doğrulama yalnızca yeni INSERT'lerde yapılır).
--
-- Güvenlik notları:
--   - ADD COLUMN IF NOT EXISTS + önce NULL olarak eklenir, backfill yapılır,
--     sonra SET NOT NULL uygulanır. Mevcut veri bozulmaz.
--   - `ADD CONSTRAINT IF NOT EXISTS` PostgreSQL'de geçersizdir; bunun yerine
--     DO $$/EXCEPTION bloğu ile pg_constraint kontrolü yapılır.
--   - appointments_active_slot_uniq (0002:62), sync_availability_status
--     (0003:307) ve tüm RLS politikaları korunur.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- A) Yeni kolonlar — önce nullable olarak ekle
-- ===========================================================================

alter table public.appointments
    add column if not exists lesson_count integer
        check (lesson_count is null or lesson_count between 1 and 30);

alter table public.appointments
    add column if not exists lesson_duration_minutes integer
        default 40;

alter table public.appointments
    add column if not exists break_duration_minutes integer
        default 10;

alter table public.appointments
    add column if not exists start_at timestamptz;

alter table public.appointments
    add column if not exists end_at timestamptz;

-- ===========================================================================
-- B) Mevcut 4 kaydı güvenli şekilde backfill et
-- ===========================================================================
-- Ders/mola dakikaları için tablo varsayılanları (40/10) yazılır.
-- lesson_count = 1 (eski tek-ders kayıtları).
-- start_at / end_at, appointments -> availability JOIN'inden türetilir
-- (available_date + start_time / end_time, UTC).
-- ---------------------------------------------------------------------------
-- NOT: Mevcut randevu tablosundaki slot_id geçerli bir availability satırına
--       işaret etmeli (0002'de on delete restrict FK). Yine de güvenlik için
--       "from availability" JOIN'i eksik slotları atlar; böylece backfill
--       tutarlı kalır. Eksik slotlu randevu kalmazsa, sonraki SET NOT NULL
--       adımı güvenli şekilde tamamlanır.
--
--   ÖNEMLİ: Backfill UPDATE'i appointments_update_guard_trg'yi tetikler;
--   bu trigger auth.uid() çağırır ve migration bağlamında (kimlik doğrulama
--   yokken) 42501 hatası fırlatır. Bu yüzden yalnızca backfill UPDATE'inin
--   başında trigger GEÇICI olarak devre dışı bırakılır (DROP EDİLMEZ) ve
--   hemen sonra yeniden etkinleştirilir. Diğer trigger'lara
--   (appointments_insert_guard_trg, appointments_delete_guard_trg,
--   sync_availability_status trigger'ları) ve RLS politikalarına
--   dokunulmaz. Migration transaction içinde hata verirse rollback eski
--   durumu (trigger etkin) koruyacaktır.
-- ---------------------------------------------------------------------------

-- Backfill UPDATE'inin update guard trigger'ına takılmaması için geçici
-- olarak devre dışı bırak (DROP DEĞİL).
alter table public.appointments
    disable trigger appointments_update_guard_trg;

update public.appointments a
   set lesson_duration_minutes = 40,
       break_duration_minutes  = 10,
       lesson_count           = 1,
       start_at               = (
           (av.available_date::timestamp) + av.start_time::interval
       ) at time zone 'UTC',
       end_at                 = (
           (av.available_date::timestamp) + av.end_time::interval
       ) at time zone 'UTC'
  from public.availability av
 where av.id = a.slot_id
   and (a.lesson_count is null
        or a.lesson_duration_minutes is null
        or a.break_duration_minutes is null
        or a.start_at is null
        or a.end_at is null);

-- Backfill tamamlandıktan sonra update guard trigger'ını yeniden etkinleştir.
alter table public.appointments
    enable trigger appointments_update_guard_trg;

-- ===========================================================================
-- C) NOT NULL zorla (backfill tamamlandıktan sonra)
-- ===========================================================================

alter table public.appointments
    alter column lesson_count set not null,
    alter column lesson_duration_minutes set not null,
    alter column break_duration_minutes set not null,
    alter column start_at set not null,
    alter column end_at set not null;

-- ===========================================================================
-- D) CHECK constraint — güvenli DO $$ bloğu (IF NOT EXISTS geçersizdir)
-- ===========================================================================

do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conname = 'appointments_time_order_chk'
           and conrelid = 'public.appointments'::regclass
    ) then
        alter table public.appointments
            add constraint appointments_time_order_chk
                check (end_at > start_at);
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conname = 'appointments_lesson_count_chk'
           and conrelid = 'public.appointments'::regclass
    ) then
        alter table public.appointments
            add constraint appointments_lesson_count_chk
                check (lesson_count between 1 and 30);
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conname = 'appointments_lesson_duration_chk'
           and conrelid = 'public.appointments'::regclass
    ) then
        alter table public.appointments
            add constraint appointments_lesson_duration_chk
                check (lesson_duration_minutes > 0);
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conname = 'appointments_break_duration_chk'
           and conrelid = 'public.appointments'::regclass
    ) then
        alter table public.appointments
            add constraint appointments_break_duration_chk
                check (break_duration_minutes >= 0);
    end if;
end $$;

-- ===========================================================================
-- E) appointments_insert_guard fonksiyonu — yeni alanlara göre güncelle
-- ===========================================================================
-- Doğrulamalar (INSERT, öğrenci INSERT'inde:
--   1) slot_id geçerli bir availability satırına işaret etmeli
--   2) slot teacher aktif olmalı
--   3) student rol = 'student'
--   4) slot status = 'open'
--   5) slot başlangıcı gelecekte olmalı (now() < available_date + start_time)
--   6) lesson_count 1-30 (CHECK constraint zaten garanti eder)
--   7) hesaplanan end_at, slot bitişini aşmamalı:
--        end_at = start_at + lesson_count*lesson_duration_minutes
--                          + (lesson_count-1)*break_duration_minutes
--   8) teacher_id / start_at / end_at / lesson_duration_minutes /
--      break_duration_minutes istemcide değil, sunucuda türetilir.
-- ---------------------------------------------------------------------------

create or replace function public.appointments_insert_guard()
returns trigger
language plpgsql
as $$
declare
    v_slot              public.availability%rowtype;
    v_student_role      text;
    v_teacher_active    boolean;
    v_start_at          timestamptz;
    v_end_at            timestamptz;
    v_total_minutes     integer;
begin
    -- 1) Slot'u getir
    select *
      into v_slot
      from public.availability
      where id = new.slot_id;

    if not found then
        raise exception 'Belirtilen randevu slotu bulunamadı. (slot_id = %)', new.slot_id
            using errcode = '23503';
    end if;

    -- 4) Slot açık olmalı
    if v_slot.status <> 'open' then
        raise exception 'Bu saat aralığı artık uygun değil (slot durumu: %). Lütfen başka bir saat deneyin.', v_slot.status
            using errcode = 'P0003';
    end if;

    -- 3) Öğrenci rolü doğrula
    select role
      into v_student_role
      from public.profiles
      where id = new.student_id;

    if v_student_role is distinct from 'student' then
        raise exception 'Randevu yalnızca öğrenci rolündeki kullanıcılar oluşturabilir.'
            using errcode = 'P0003';
    end if;

    -- 2) Öğretmen aktif olmalı
    select is_active
      into v_teacher_active
      from public.profiles
      where id = v_slot.teacher_id;

    if not found or v_teacher_active is not true then
        raise exception 'Seçilen öğretmen artık aktif değil.'
            using errcode = 'P0003';
    end if;

    -- teacher_id istemci tarafından gönderilmez; slot'tan türet
    new.teacher_id := v_slot.teacher_id;

    if new.teacher_id = new.student_id then
        raise exception 'Bir öğretmen kendine randevu oluşturamaz.'
            using errcode = 'P0003';
    end if;

    -- 8) Ders/mola dakikaları: eksikse varsayılanla doldur
    if new.lesson_duration_minutes is null then
        new.lesson_duration_minutes := 40;
    end if;
    if new.break_duration_minutes is null then
        new.break_duration_minutes := 10;
    end if;

    -- 6) lesson_count aralığı
    if new.lesson_count is null
       or new.lesson_count < 1
       or new.lesson_count > 30 then
        raise exception 'Ders sayısı 1 ile 30 arasında olmalıdır.'
            using errcode = 'P0003';
    end if;

    -- 7) start_at / end_at sunucu tarafından türetilir
    v_start_at := (
        (v_slot.available_date::timestamp) + v_slot.start_time::interval
    ) at time zone 'UTC';

    v_total_minutes :=
        new.lesson_count * new.lesson_duration_minutes
        + (new.lesson_count - 1) * new.break_duration_minutes;

    v_end_at := v_start_at + (v_total_minutes || ' minutes')::interval;

    -- 5) Başlangıç gelecekte olmalı
    if v_start_at <= now() then
        raise exception 'Bu başlangıç saati artık geçmişte. Lütfen başka bir saat seçin.'
            using errcode = 'P0003';
    end if;

    -- 7b) Hesaplanan bitiş, slot bitişini aşmamalı
    if v_end_at > (
        (v_slot.available_date::timestamp) + v_slot.end_time::interval
    ) at time zone 'UTC' then
        raise exception 'Bu başlangıç saati seçilen ders sayısı için yeterli değildir.'
            using errcode = 'P0003';
    end if;

    new.start_at := v_start_at;
    new.end_at   := v_end_at;

    -- status istemcide belirtilmemişse pending kabul edilir
    if new.status is null then
        new.status := 'pending';
    end if;

    return new;
end;
$$;

-- ===========================================================================
-- F) Trigger'ı güvenli şekilde yeniden bağla
-- ===========================================================================

drop trigger if exists appointments_insert_guard_trg on public.appointments;
create trigger appointments_insert_guard_trg
    before insert on public.appointments
    for each row execute function public.appointments_insert_guard();

-- ---------------------------------------------------------------------------
-- Korunan unsurlar (dokunulmadı):
--   - RLS politikaları (appointments_read/insert/update/delete_policy)
--   - appointments_active_slot_uniq (0002:62) — çift rezervasyon engeli
--   - sync_availability_status() + after insert/update/delete trigger'ları
--   - appointments_update_guard_trg / appointments_delete_guard_trg
-- ---------------------------------------------------------------------------
