-- |--------------------------------------------------------------------------
-- Migration: 0021_appointments_flexible_booking.sql
-- Açıklama:
--   appointments_insert_guard fonksiyonunu esnek (flexible) rezervasyon
--   modeline göre yeniden yazar:
--     - requested_start_time kullanılarak start_at türetilir.
--     - Öğretmen profiles ayarları (lesson_duration_minutes,
--       lesson_break_minutes, student_buffer_minutes — 0017) okunur ve
--       appointments'a snapshot olarak yazılır.
--     - end_at, ders/mola formülüyle hesaplanır.
--     - blocked_until = end_at + student_buffer_minutes.
--     - availability penceresi sınırları doğrulanır (start + end + blocked).
--     - Aynı öğretmenin aktif randevularıyla [start_at, blocked_until)
--       aralığında çakışma kontrolü yapılır (cancelled/completed hariç).
--
--   Bu adım yalnızca trigger FONKSİYONUNU günceller (advisory lock dahil).
--   Trigger'ı yeniden bağlama, backfill, NOT NULL yükseltme ve eski
--   appointments_active_slot_uniq indeksinin kaldırılması SONRAKi adımlarda
--   yapılır; burada yapılmaz (atomiklik ve güvenli geçiş için).
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.profiles
--     - lesson_duration_minutes  (0017)  DEFAULT 40, CHECK >0 AND <=480
--     - lesson_break_minutes      (0017)  DEFAULT 10, CHECK >=0 AND <=120
--     - student_buffer_minutes    (0017)  DEFAULT 10, CHECK >=0 AND <=120
--   public.availability
--     - available_date, start_time, end_time, status, teacher_id (0001)
--   public.appointments
--     - lesson_count                (0015) NOT NULL, 1..30
--     - lesson_duration_minutes     (0015) DEFAULT 40, >0
--     - break_duration_minutes      (0015) DEFAULT 10, >=0
--     - start_at, end_at            (0015) NOT NULL timestamptz
--     - requested_start_time        (0020) nullable time
--     - student_buffer_minutes      (0020) nullable int
--     - blocked_until               (0020) nullable timestamptz
--   public.appointments_insert_guard()        (0003 / 0015) -> üzerine yazılır
--   public.appointments_insert_guard_trg      (0015)        -> sonra yeniden bağlanır
--
-- Tasarım kararları:
--   * lesson_duration_minutes / break_duration_minutes / student_buffer_minutes
--     ÖĞRETMEN profiles'indan okunur (0017) ve randevu satırına SNAPSHOT
--     olarak yazılır. Nedeni: öğretmen sonradan ayarını değiştirse bile bu
--     randevunun geçmiş değeri korunur (history/audit) ve çakışma matematiği
--     deterministik kalır. 0015 zaten lesson_duration/break için snapshot
--     kullanıyordu; 0021 break_duration_minutes'i DE profiles'tan okuyacak
--     şekilde genişletir (0015 modeli lesson_duration_minutes/break'ı
--     istemciden alabiliyordu; 0021 bunu override eder ve her zaman
--     profiles'tan çeker).
--   * requested_start_time (time) kullanılarak start_at timestamptz
--     üretilir: start_at = (available_date + requested_start_time) UTC.
--     Eğer requested_start_time NULL gelirse, geriye dönük uyumluluk için
--     availability.start_time kullanılır (geçiş dönemi güvenliği).
--   * end_at = start_at + lesson_count*lesson_duration_minutes
--              + (lesson_count-1)*break_duration_minutes
--     (Aynı 0015 formülü; ancak artık değerler profiles'tan snapshot).
--   * blocked_until = end_at + student_buffer_minutes ( dk ).
--     Öğretmen buffer'ı 0 ise blocked_until = end_at.
--   * Availability pencere doğrulaması:
--       slot_start = available_date + start_time (UTC)
--       slot_end   = available_date + end_time   (UTC)
--       start_at        >= slot_start
--       end_at          <= slot_end
--       blocked_until   <= slot_end   (buffer dışarı taşmasın)
--   * Çakışma kontrolü:
--       SAME teacher_id, status IN ('pending','confirmed') — yani
--       cancelled/completed hariç — ve aralık kesişimi:
--           new.start_at  < other.blocked_until
--       AND other.start_at < new.blocked_until
--       ise çakışma var demektir; P0003 fırlatılır.
--   * RACE CONDITION KORUMASI — pg_advisory_xact_lock:
--       SELECT count(*) çakışma kontrolü tek başına race condition'a
--       açıktır (iki paralel INSERT aynı teacher_id için aynı aralığı talep
--       ederse her ikisi de count=0 görebilir). Bu yüzden çakışma
--       sorgusundan ÖNCE öğretmen bazında advisory lock alınır:
--           pg_advisory_xact_lock(hashtext('appt:' || teacher_id::text))
--       Bu kilit transaction sonuna kadar tutulur ve otomatik bırakılır.
--       Aynı teacher_id'ye paralel INSERT'leri serileştirir; düşük-orta
--       trafikli bu proje için yeterli ve pgbouncer (transaction mode dahil)
--       ile uyumludur. Yüksek trafik gerektiğinde gelecekte exclusion
--       constraint'e geçiş mümkündür.
--     NOT: appointments_active_slot_uniq (0002:62) kaldırılacak (sonraki
--     adım). Bu fonksiyon advisory lock + SELECT count(*) ile çakışmayı
--     deterministik yakaladığı için indeks artık gereksizdir; esnek modelde
--     yetersiz kalır (aynı slot_id'ye farklı requested_start_time'larla
--     birden fazla aktif randevu izni vermek istiyoruz).
--
-- Güvenlik notları:
--   * Fonksiyon SECURITY DEFINER değildir (Invoker); ancak RLS politikaları
--     appointments_insert_policy (0002:84) student reqs'ini zaten korur.
--     teacher_id / start_at / end_at / blocked_until / student_buffer_minutes
--     istemci tarafından gönderilse bile trigger tarafından ZORLA override
--     edilir; istemcinin değeri yok sayılır.
--   * Mevcut 4 randevu kaydı bu fonksiyondan etkilenmez (BACKFILL BU ADIMDA
--     YAPILMAZ). Fonksiyon yalnızca yeni INSERT'lerde devreye girer.
--   * Lerleme da yok — eski kayıtlar requested_start_time=NULL  ve
--     blocked_until=NULL ile yaşamaya devam eder. Backfill sonraki adımda.
--   * sync_availability_status (0003) — bu adımda DOKUNULMAZ.
--   * appointments_update_guard / appointments_delete_guard — dokunulmaz.
--   * notifications trigger (0008) — dokunulmaz.
--   * RLS politikaları — dokunulmaz.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- A) appointments_insert_guard fonksiyonu — esnek rezervasyon modeli
-- ===========================================================================
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
    v_teacher_student_buffer        integer;

    -- Hesaplanan anlar
    v_slot_start                   timestamptz;
    v_slot_end                     timestamptz;
    v_start_at                     timestamptz;
    v_end_at                       timestamptz;
    v_blocked_until                timestamptz;
    v_total_minutes                integer;

    -- Çakışma kontrolü için
    v_conflict_count               integer;

    -- requested_start_timeNULL ise slot.start_time kullan (geçiş güvenliği)
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
    --     serileştirilir; ikinci transaction Bloklar Birinci commit
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

-- ---------------------------------------------------------------------------
-- NOT: Bu adımda trigger YENİDEN BAĞLANMAZ. Mevcut appointments_insert_guard_trg
--      (0015) hâlâ ESKİ fonksiyon gövdesini gösteriyor olabilir — ancak
--      CREATE OR REPLACE FUNCTION aynı isimle yeniden tanımladığı için
--      trigger otomatik olarak yeni gövdeyi çağırır. Trigger'ı drop/create
--      etmeye gerek yoktur. Yine de güvenli olması açısından bir sonraki
--      adımda yeniden bağlama yapılacak (idempotentliği güçlendirmek için).
--
-- ADVISORY LOCK — uygulama önerileri:
--   * pg_advisory_xact_lock hashtext üzerinden alındığı için hash çarpışması
--     teorik olarak mümkündür; ancak teacher_id uuid olduğundan two
--     farklı teacher için aynı hash çakışsa bile, her ikisi de kendi
--     teacher_id'leri için serileştirilir — yanlış negatif/positif oluşmaz.
--     Kilit yalnızca gereksiz bekleme yaratabilir (performans değil, doğruluk).
--   * pgbouncer transaction mode (Supabase varsayılan) ile uyumlu, çünkü
--     xact lock transaction sonunda bırakılır (session'a bağlı değil).
--   * Hata (raise exception) durumunda lock otomatik bırakılır (rollback).
--
-- Korunan unsurlar (dokunulmadı):
--   * appointments_active_slot_uniq (0002:62) — sonraki adımda kaldırılacak.
--     Bu migration fonksiyonu, indeks varken de çalışır; indeks esnek modelde
--     gereksiz kısıt yaratır (tek slot'ta tek aktif randevu) — kaldırılmadan
--     istemciler hata alabilir. Bu yüzden kaldırılması sonraki adımda ZORUNLU.
--   * appointments_update_guard_trg / appointments_delete_guard_trg (0003)
--     — değiştirilmez.
--   * sync_availability_status() (0003/0005) — AŞAĞIDAKİ B) ADIMINDA
--     güncellenir (esnek model: slot 'open' kalır, actively bookedcount
--     pencere geçene kadar veya manuel olarak).
--   * notifications trigger (0008)
--   * RLS politikaları (0002)
--   * get_teacher_profiles() / public_teacher_profiles (0011) — 0022'de
--     genişletilecek
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- B) Backfill — mevcut randevuları esnekmodele geçiş için hazırla
-- ===========================================================================
-- Mevcut appointments satırları requested_start_time, student_buffer_minutes
-- ve blocked_until alanlarını NULL taşıyor (0020'de nullable eklendi).
-- Backfill bu üç alanı güvenli şekilde doldurur:
--
--   * requested_start_time := (start_at AT TIME ZONE 'UTC')::time
--     Mevcut start_at zaten availability.available_date + start_time'dan
--     üretilmişti (0015 backfill). Bu nedenle UTC'de time'a projekte
--     ediyoruz.
--   * student_buffer_minutes := 0
--     Eski kayıtlar için hangi öğretmen buffer'ının o an olduğunu bilemeyiz;
--     güvenli varsayılan 0 (blocked_until = end_at). Bu eskiden beri buffer
--     olmadan çalıştırılan sistemle uyumludur.
--   * blocked_until := end_at
--     student_buffer_minutes = 0 olduğu için buffer yok; blocked_until =
--     end_at. Geçmiş randevuların gerçek buffer'ı zaten geçmişte kayboldu.
--
-- Ayrıca bu satırlarda lesson_duration_minutes / break_duration_minutes
-- zaten dolu (0015 backfill) — bu adımda bu alanlara DOKUNMAYIZ, overlap yok.
--
-- Backfill UPDATE'i appointments_update_guard_trg'yi tetikler; bu trigger
-- auth.uid() çağırır ve migration bağlamında 42501 hatası fırlatır. Bu yüzden
-- yalnızca backfill UPDATE'inin başında trigger GEÇİCI olarak devre dışı
-- bırakılır (DROP DEĞİL) ve hemen sonra yeniden etkinleştirilir. Diğer
-- trigger'lara (insert_guard, delete_guard, sync_availability_status,
-- notifications) ve RLS politikalarına dokunulmaz. Migration transaction
-- içinde hata verirse rollback trigger'ı etkin duruma geri korur.
--
-- Idempotentlik: yalnızca NULL olan alanlar doldurulur; tekrar çalıştırılırsa
-- etkilenen satır olmaz.
-- ---------------------------------------------------------------------------
alter table public.appointments
    disable trigger appointments_update_guard_trg;

update public.appointments
   set requested_start_time = (start_at at time zone 'UTC')::time,
       student_buffer_minutes = 0,
       blocked_until = end_at
 where requested_start_time is null
    or student_buffer_minutes is null
    or blocked_until is null;

alter table public.appointments
    enable trigger appointments_update_guard_trg;

-- ===========================================================================
-- C) NOT NULL geçişleri — backfill sonrası güvenli yükselt
-- ===========================================================================
-- Backfill tamamlandığında tüm randevular bu üç alanı taşır; artık NOT NULL
-- olabilir. Eğer eksik satır varsa SET NOT NULL hata verecektir — bu
-- beklenen davranıştır (veri tutarlılılığını garanti eder).
-- ---------------------------------------------------------------------------
alter table public.appointments
    alter column requested_start_time set not null;

alter table public.appointments
    alter column student_buffer_minutes set not null;

alter table public.appointments
    alter column blocked_until set not null;

-- ===========================================================================
-- D) appointments_active_slot_uniq — KALDIR
-- ===========================================================================
-- 0002:62'de tanımlı partial unique index:
--     create unique index appointments_active_slot_uniq
--         on public.appointments (slot_id)
--         where status in ('pending', 'confirmed');
--
-- Esnek modelde aynı slot içinde birden fazla aktif randevu (farklı
-- requested_start_time'larla) izin verilmesi gerekiyor. Bu indeks o
-- senaryoyu engeller. Çakışma kontrolü artık appointments_insert_guard
-- içinde advisory lock + SELECT count(*) ile deterministik yapılıyor;
-- indeksin yedekliğe ihtiyaç yoktur.
--
-- Not: Aynı slot'ta çakışan zaman aralıklarını engellemek hâlâ trigger'ın
-- görevidir (adım 12). Bu indeks yalnızca slot başına tek aktif kayıt
-- kuralını içeren yetersiz kısıtı ortadan kaldırır.
--
-- Idempotent: drop index if exists.
-- ---------------------------------------------------------------------------
drop index if exists public.appointments_active_slot_uniq;

-- ===========================================================================
-- E) sync_availability_status — esnek modele uyarla
-- ===========================================================================
-- 0003/0005'teki mevcut fonksiyon INSERT sonrası availability.status='booked'
-- yazar. Bu esnek modelde yanlıştır: aynı slot'taki ikinci öğrenci artık
-- slotu kullanılamaz (insert_guard status='open' kontrolü reddeder).
--
-- Yeni davranış:
--   * INSERT: slot'u booked YAPMA. O açık kalır ('open') — çünkü aynı
--     slot'ta başka öğrenciler farklı requested_start_time'larla randevu
--     açabilmeli. Çakışma trigger'da advisory lock + SELECT count(*) ile
--     yakalanıyor; availability.status artık randevu varlığını kontrol
--     etmek için kullanılmıyor.
--   * UPDATE (confirmed/completed): slot 'open' kalır (esnek model için
--     önemli değil — randevular ayrı zamanlarda olabilir, hepsine izin
--     vermemesi için pencere dolu olmalı).
--   * UPDATE (cancelled): slot yalnızca pending/confirmed randevu
--     kalmadıysa 'open' yapılır (mevcut davranış korunur — slot tekrar
--     kullanıma hazır). 'open' zaten bir yedekleme yapılmadığı için bu
--     yine mantıklı.
--   * DELETE: pending/confirmed randevu kalmadıysa slot 'open' yapılır
--     (mevcut davranış korunur).
--
-- Önemli karar: pencere (available_date + end_time) geçmişse artık slot
-- 'booked' yerine 'closed' veya 'blocked' işaretlenmemeli — bu sorun
-- 'booked' yazma mantığını tamamen terk etmek. Eğer gelecekte slot'ların
-- pencere geçince 'closed' olması istenirse, bu ayrı bir migration
-- konusudur (örn. 0022 veya 0023 tarih geçişi job'u). Bu migration SLOT
-- STATUS'ÜNÜ 'booked' YAPAN davranışı kaldırır; 'open' durumda bırakır.
--
-- SECURITY: fonksiyon SECURITY DEFINER + search_path = public, pg_temp
-- (0005) korunur — mevcut güvenlik modeli aynen kalır. Yalnızca davranış
-- (booked yazma) kaldırılır.
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
    -- INSERT: esnek model — slot 'open' kalır.
    -- Birden fazla öğrenci aynı slot'ta farklı requested_start_time'larla
    -- randevu açabilir. Çakışma appointments_insert_guard'da kontrol edilir.
    if TG_OP = 'INSERT' then
        return new;
    end if;

    if TG_OP = 'UPDATE' then
        -- confirmed/completed: slot yine 'open' kalır (esnek model mantığı).
        -- Yalnızca cancelled olduğunda ve aktif randevu kalmadıysa 'open'
        -- yapılır (zaten 'open' olduğundan no-op). 'booked' durumu artık
        -- kullanılmıyor.
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
-- E.b) OWNER TO postgres KALDIRILDI — Supabase Dashboard SQL Editor
--      bağlamı `postgres` rolünde olmayabilir; `alter function ... owner`
--      izin hatası verip migration'ı yarıda bırakabilir. create or replace
--      function zaten fonksiyon sahibini değiştirmez; 0005'te de_owner
--      belirtilmemişti. Burada dokunmuyoruz.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- F) Trigger'ı yeniden bağla — idempotentlik garantisi
-- ===========================================================================
-- create or replace function aynı isimle yeniden tanımlandığı için trigger
-- otomatik yeni gövdeyi çağırır. Ancak idempotentliği güçlendirmek ve
-- migration geçmişinde kesin durumu garanti etmek için drop/create yapıyoruz.
-- ---------------------------------------------------------------------------
drop trigger if exists appointments_insert_guard_trg on public.appointments;
create trigger appointments_insert_guard_trg
    before insert on public.appointments
    for each row execute function public.appointments_insert_guard();

-- ===========================================================================
-- G) Audit / korunan unsurlar
-- ===========================================================================
-- Bu migration'da DEĞİŞMEyen:
--   * appointments_update_guard_trg / appointments_delete_guard_trg (0003)
--     — backfill sırasında geçici disable edildi, sonra enable edildi, kalıcı
--       değişiklik yok.
--   * notifications trigger (0008)
--   * RLS politikaları (0002)
--   * profiles_before_update_guard / profiles RLS (0003)
--   * get_teacher_profiles() / public_teacher_profiles (0011) — 0022'de
--     genişletilecek
--   * availability tablosu yapısı (0001/0018/0019)
--
-- Bu migration'da DEĞİŞEN:
--   * appointments_insert_guard() — esnek model + advisory lock (A)
--   * Backfill (B) — requested_start_time, student_buffer_minutes, blocked_until
--   * NOT NULL yükseltme (C) — üç kolon
--   * appointments_active_slot_uniq index DROP (D)
--   * sync_availability_status() — 'booked' davranışı kaldırıldı, 'open' kaldı (E)
--   * appointments_insert_guard_trg — drop/create (F)
-- ---------------------------------------------------------------------------


