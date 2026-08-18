-- |--------------------------------------------------------------------------
-- | Migration: 0027_appointments_lesson_mode.sql
-- | Açıklama:
-- |   appointments tablosuna "ders türü" bilgisini saklamak için lesson_mode
-- |   kolonu ekler. Öğrenci randevu oluştururken online / in_person
-- |   değerlerinden birini zorunlu olarak seçmelidir.
-- |   - Yeni kolon önce nullable olarak eklenir (eski randevular bozulmaz).
-- |   - CHECK constraint yalnızca online / in_person / NULL değerlerine izin
-- |     verir.
-- |   - Mevcut randevular için backfill yapılmaz; lesson_mode = NULL kalır
-- |     ve UI'da "Belirtilmedi" olarak gösterilir (geriye dönük uyumluluk).
-- |   - NOT NULL uygulanmaz; eski kayıtlar NULL kalabilmeli.
-- |   - appointments_insert_guard trigger fonksiyonu (0021) güncellenerek
-- |     yeni INSERT'lerde lesson_mode zorunluluğu server-side garantilenir.
-- |---------------------------------------------------------------------------
-- | Bağımlılıklar:
-- |   public.appointments (0002 / 0015 / 0020 / 0021) -> mevcut
-- |   public.appointments_insert_guard()             (0021)         -> üzerine yazılır
-- |   public.appointments_insert_guard_trg           (0021)         -> yeniden bağlanır
-- |
-- | Güvenlik notları:
-- |   * Eski randevular lesson_mode = NULL taşır; doğrulama yalnızca yeni
-- |     INSERT'lerde uygulanır. Mevcut update (onay/iptal/tamamlandı) ve
-- |     delete akışları etkilenmez.
-- |   * RLS politikaları (0002), sync_availability_status (0021),
-- |     appointments_update_guard / appointments_delete_guard (0003),
-- |     notifications trigger (0008) KORUNUR — hiçbirine dokunulmaz.
-- |   * Çakışma / advisory lock / süre / buffer / mola hesabı mantığı
-- |     (0021) aynen korunur; yalnızca yeni bir zorunluluk doğrulaması eklenir.
-- |   * Migration idempotent.
-- |---------------------------------------------------------------------------

-- ===========================================================================
-- A) Yeni kolon — nullable olarak ekle
-- ===========================================================================
alter table public.appointments
    add column if not exists lesson_mode text;

-- ===========================================================================
-- B) CHECK constraint — yalnızca online / in_person / NULL değerleri
--    (ADD CONSTRAINT IF NOT EXISTS geçersizdir; DO $$ bloğu ile güvenli ekle)
-- ===========================================================================
do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conname = 'appointments_lesson_mode_chk'
           and conrelid = 'public.appointments'::regclass
    ) then
        alter table public.appointments
            add constraint appointments_lesson_mode_chk
                check (lesson_mode is null
                       or lesson_mode in ('online', 'in_person'));
    end if;
end $$;

-- ===========================================================================
-- C) appointments_insert_guard fonksiyonu — lesson_mode zorunluluğu ekle
-- ===========================================================================
-- Mevcut 0021 fonksiyon gövdesi birebir korunur; yalnızca yeni bir
-- doğrulama adımı eklenir (adım 6b): lesson_mode NULL ya da('online','in_person')
-- dışı bir değer ise raise P0003. Diğer tüm mantık (slot doğrulama, öğrenci
-- rolü, öğretmen aktifliği, teacher_id türetme, lesson_count doğrulama,
-- snapshot, requested_start_time, start_at/end_at/blocked_until türetme,
-- availability pencere sınırları, advisory lock + çakışma kontrolü) aynen
-- korunur.
-- ---------------------------------------------------------------------------
create or replace function public.appointments_insert_guard()
returns trigger
language plpgsql
as $$
declare
    v_slot                         public.availability%rowtype;
    v_student_role                 text;
    v_teacher_active               boolean;

    -- Öğretmen süre ayarları (0017) — snapshot için okur
    v_teacher_lesson_duration      integer;
    v_teacher_lesson_break         integer;
    v_teacher_student_buffer       integer;

    -- Hesaplanan anlar
    v_slot_start                   timestamptz;
    v_slot_end                     timestamptz;
    v_start_at                     timestamptz;
    v_end_at                       timestamptz;
    v_blocked_until                timestamptz;
    v_total_minutes                integer;

    -- Çakışma kontrolü için
    v_conflict_count               integer;

    -- requested_start_time NULL ise slot.start_time kullan (geçiş güvenliği)
    v_req_start                    time;
begin
    -- -----------------------------------------------------------------------
    -- 1) Slot'u getir
    -- -----------------------------------------------------------------------
    select *
      into v_slot
      from public.availability
      where id = new.slot_id;

    if not found then
        raise exception 'Belirtilen randevu slotu bulunamadı. (slot_id = %)',
            new.slot_id
            using errcode = '23503';
    end if;

    -- -----------------------------------------------------------------------
    -- 2) Slot açık olmalı
    -- -----------------------------------------------------------------------
    if v_slot.status <> 'open' then
        raise exception 'Bu saat aralığı artık uygun değil (slot durumu: %). Lütfen başka bir saat deneyin.',
            v_slot.status
            using errcode = 'P0003';
    end if;

    -- -----------------------------------------------------------------------
    -- 3) Öğrenci rolü doğrula
    -- -----------------------------------------------------------------------
    select role
      into v_student_role
      from public.profiles
      where id = new.student_id;

    if v_student_role is distinct from 'student' then
        raise exception 'Randevu yalnızca öğrenci rolündeki kullanıcılar oluşturabilir.'
            using errcode = 'P0003';
    end if;

    -- -----------------------------------------------------------------------
    -- 4) Öğretmen aktif olmalı + süre ayarlarını oku (0017)
    -- -----------------------------------------------------------------------
    select is_active,
           lesson_duration_minutes,
           lesson_break_minutes,
           student_buffer_minutes
      into v_teacher_active,
           v_teacher_lesson_duration,
           v_teacher_lesson_break,
           v_teacher_student_buffer
      from public.profiles
      where id = v_slot.teacher_id;

    if not found or v_teacher_active is not true then
        raise exception 'Seçilen öğretmen artık aktif değil.'
            using errcode = 'P0003';
    end if;

    -- NOT: 0017 NOT NULL DEFAULT ile eklediği için burada NULL gelmemeli.
    -- Yine de güvenlik için varsayılanlara düş (defansif programlama):
    if v_teacher_lesson_duration is null then
        v_teacher_lesson_duration := 40;
    end if;
    if v_teacher_lesson_break is null then
        v_teacher_lesson_break := 10;
    end if;
    if v_teacher_student_buffer is null then
        v_teacher_student_buffer := 10;
    end if;

    -- -----------------------------------------------------------------------
    -- 5) teacher_id / student_id tutarlılığı (interaction yine de override)
    -- -----------------------------------------------------------------------
    new.teacher_id := v_slot.teacher_id;

    if new.teacher_id = new.student_id then
        raise exception 'Bir öğretmen kendine randevu oluşturamaz.'
            using errcode = 'P0003';
    end if;

    -- -----------------------------------------------------------------------
    -- 6) lesson_count doğrula (CHECK constraint de garanti eder)
    -- -----------------------------------------------------------------------
    if new.lesson_count is null
       or new.lesson_count < 1
       or new.lesson_count > 30 then
        raise exception 'Ders sayısı 1 ile 30 arasında olmalıdır.'
            using errcode = 'P0003';
    end if;

    -- -----------------------------------------------------------------------
    -- 6b) lesson_mode doğrula — YENİ ADIM (0027)
    --     Öğrenci ders türünü (online / in_person) zorunlu seçmelidir.
    --     NULL ya da farklı bir değer reddedilir. Eski randevular bu
    --     trigger'dan etkilenmediği için geriye dönük uyumluluk korunur.
    -- -----------------------------------------------------------------------
    if new.lesson_mode is null
       or (new.lesson_mode <> 'online' and new.lesson_mode <> 'in_person') then
        raise exception 'Lütfen ders türünü seçin (Online veya Yüz Yüze).'
            using errcode = 'P0003';
    end if;

    -- -----------------------------------------------------------------------
    -- 7) Snapshot: öğretmen süre ayarlarını appointments'a yaz
    --    (İstemci değeri varsa EZER ve profiles'tan gelen kazanır.)
    -- -----------------------------------------------------------------------
    new.lesson_duration_minutes := v_teacher_lesson_duration;
    new.break_duration_minutes  := v_teacher_lesson_break;
    new.student_buffer_minutes  := v_teacher_student_buffer;

    -- -----------------------------------------------------------------------
    -- 8) requested_start_time çözümle; NULL ise slot.start_time ile geri düş
    -- -----------------------------------------------------------------------
    if new.requested_start_time is not null then
        v_req_start := new.requested_start_time;
    else
        v_req_start := v_slot.start_time;
        new.requested_start_time := v_slot.start_time;
    end if;

    -- -----------------------------------------------------------------------
    -- 9) start_at = available_date + requested_start_time (UTC)
    --    end_at   = start_at + lesson_count * lesson_duration
    --                        + (lesson_count - 1) * break_duration
    --    blocked_until = end_at + student_buffer_minutes
    -- -----------------------------------------------------------------------
    v_slot_start := (
        (v_slot.available_date::timestamp) + v_slot.start_time::interval
    ) at time zone 'UTC';

    v_slot_end := (
        (v_slot.available_date::timestamp) + v_slot.end_time::interval
    ) at time zone 'UTC';

    v_start_at := (
        (v_slot.available_date::timestamp) + v_req_start::interval
    ) at time zone 'UTC';

    v_total_minutes :=
        new.lesson_count * new.lesson_duration_minutes
        + (new.lesson_count - 1) * new.break_duration_minutes;

    v_end_at := v_start_at + (v_total_minutes || ' minutes')::interval;

    v_blocked_until := v_end_at
        + (new.student_buffer_minutes || ' minutes')::interval;

    -- -----------------------------------------------------------------------
    -- 10) Başlangıç gelecekte olmalı
    -- -----------------------------------------------------------------------
    if v_start_at <= now() then
        raise exception 'Bu başlangıç saati artık geçmişte. Lütfen başka bir saat seçin.'
            using errcode = 'P0003';
    end if;

    -- -----------------------------------------------------------------------
    -- 11) availability pencere sınırları
    --    * start_at slot başlangıcından önce olamaz.
    --    * end_at   slot bitişini aşamaz.
    --    * blocked_until slot bitişini aşamaz (buffer dışarı taşamaz).
    -- -----------------------------------------------------------------------
    if v_start_at < v_slot_start then
        raise exception 'İstenen başlangıç saati, slot başlangıcından önce olamaz.'
            using errcode = 'P0003';
    end if;

    if v_end_at > v_slot_end then
        raise exception 'Bu başlangıç saati seçilen ders sayısı için yeterli değildir (bitiş slot penceresini aşıyor).'
            using errcode = 'P0003';
    end if;

    if v_blocked_until > v_slot_end then
        raise exception 'Öğrenci arası buffer süresi slot penceresini aşıyor. Daha küçük bir başlangıç veya daha az ders sayısı deneyin.'
            using errcode = 'P0003';
    end if;

    -- -----------------------------------------------------------------------
    -- 12) Çakışma kontrolü — aynı öğretmenin aktif randevuları
    --     Durumlar: pending | confirmed (cancelled / completed hariç)
    --     Kesişim: [new.start_at, new.blocked_until) ∩ [other.start_at, other.blocked_until)
    --     Kesişim olursa P0003 fırlatılır.
    --     NOT: blocked_until NULL olabilir (eski 0020 öncesi kayıt) —
    --     bu durumda fallback olarak other.end_at kullanılır (buffer = 0).
    --
    --     RACE CONDITION KORUMASI:
    --     SELECT count(*) tek başına güvenli değildir; iki paralel INSERT
    --     aynı teacher_id için çakışan aralık talep ederse her ikisi de
    --     count=0 görebilir ve iki çakışan randevu oluşur. Bu yüzden
    --     çakışma sorgusundan ÖNCE öğretmen bazında transaction-level
    --     advisory lock alınır. Aynı teacher_id'ye paralel INSERT'ler
    --     serileştirilir; ikinci transaction bloklar birinci commit
    --     edene kadar, sonra kendi çakışma kontrolünü deterministik
    --     olarak yapar. Lock transaction bitiminde otomatik bırakılır.
    --     pg_advisory_xact_lock (session lock DEĞİL, xact lock) =>
    --     pgbouncer transaction mode ile uyumlu.
    -- -----------------------------------------------------------------------
    -- new.teacher_id bu noktada zaten v_slot.teacher_id olarak set edildi
    -- (adım 5). Kilidi bu öğretmen için al.
    perform pg_advisory_xact_lock(
        hashtext('appt:' || new.teacher_id::text)
    );

    select count(*)::integer
      into v_conflict_count
      from public.appointments a
     where a.teacher_id = new.teacher_id
       and a.status in ('pending', 'confirmed')
       and a.id is distinct from new.id
       and a.start_at < v_blocked_until
       and coalesce(a.blocked_until, a.end_at) > v_start_at;

    if v_conflict_count > 0 then
        raise exception 'Seçilen zaman aralığı bu öğretmenin başka bir randevusuyla çakışıyor. Lütfen başka bir saat deneyin.'
            using errcode = 'P0003';
    end if;

    -- -----------------------------------------------------------------------
    -- 13) Trigger, sunucu türevli alanları ZORLA yaz (istemci değeri yok say)
    -- -----------------------------------------------------------------------
    new.start_at      := v_start_at;
    new.end_at        := v_end_at;
    new.blocked_until := v_blocked_until;

    -- status NULL ise pending kabul et (0015 ile uyumlu)
    if new.status is null then
        new.status := 'pending';
    end if;

    return new;
end;
$$;

-- ===========================================================================
-- D) Trigger'ı güvenli şekilde yeniden bağla — idempotentlik garantisi
--    create or replace function aynı isimle yeniden tanımlandığı için
--    trigger otomatik yeni gövdeyi çağırır; ancak idempotentliği güçlendirmek
--    için drop/create yapıyoruz.
-- ===========================================================================
drop trigger if exists appointments_insert_guard_trg on public.appointments;
create trigger appointments_insert_guard_trg
    before insert on public.appointments
    for each row execute function public.appointments_insert_guard();

-- ---------------------------------------------------------------------------
-- Korunan unsurlar (dokunulmadı):
--   * RLS politikaları (appointments_read/insert/update/delete_policy) (0002)
--   * sync_availability_status() (0021) — 'booked' davranışı yine yok
--   * appointments_update_guard_trg / appointments_delete_guard_trg (0003)
--   * appointments_requested_start_time, student_buffer_minutes,
--     blocked_until — 0020/0021'de eklendi, burada DEĞİŞTİRİLMEDİ
--   * notifications trigger (0008)
--   * profiles_before_update_guard / profiles RLS (0003)
--   * get_teacher_profiles() / public_teacher_profiles (0011 / 0022)
--   * availability tablosu yapısı (0001/0018/0019)
--   * süre / mola / buffer / çakışma hesabı (0021) — aynen korundu
-- ---------------------------------------------------------------------------
