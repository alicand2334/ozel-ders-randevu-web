-- |--------------------------------------------------------------------------
-- Migration: 0020_appointments_requested_start_and_blocked.sql
-- Açıklama:
--   appointments tablosuna esnek başlangıç saati ve öğrenciler arası buffer
--   kavramlarını ekler:
--     - requested_start_time : öğrencinin availability penceresinden seçtiği
--                               başlangıç saati (time). trigger (0021)
--                               start_at'ı available_date +
--                               requested_start_time'dan türetir.
--     - blocked_until        : end_at + student_buffer_minutes. Bu andan
--                               önce başka bir öğrenci başlayamaz (çakışma
--                               kontrolü 0021'de). Öğretmen buffer'ı 0 ise
--                               blocked_until = end_at.
--   Şimdilik nullable/default ile eklenir; 0021 migration'ında trigger
--   güncellenir, backfill yapılır ve NOT NULL'a yükseltilmesini burada
--   yapmayız (trigger.backfill dependent olduğu için).
--
--   BLOCKED_UNTIL AVAILABILITY BİTİŞİNİ AŞARSA: planmıza göre reddetme
--   politikası seçtik (task 6). blocked_until > availability.end_time
--   ise INSERT trigger (0021) raise P0003 yapacak. Bu migration yalnızca
--   kolonu ekler; doğrulama 0021'de.
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.appointments (0002 / 0015) -> mevcut
--
-- Veri modeli notları:
--   * requested_start_time::time — start_at timestamptz'den farklı. start_at
--     trigger tarafından available_date + requested_start_time'dan türetilir
--     (0021). Mevcut 0015 trigger'ı start_at'ı slot.start_time'dan türetiyor;
--     0021 bunu değiştirecek.
--   * blocked_until timestamptz — end_at + student_buffer_minutes. trigger
--     tarafından student_buffer_minutes öğretmen profiles'undan (0017) çekilir
--     VE o an için snapshot olarak appointments tablosuna YAZILIR (task 4:
--    /randevu anlık değerleri snapshot olarak sakla).
--     NEDEN snapshot? Öğretmen buffer'ı değiştirirse eski randevuların
--     "kendi anındaki buffer"larını koruyalım, history/audit için. Çakışma
--     kontrolü yine snapshot blocked_until'i kullanır — bu da hesabı
--     deterministik yapar.
--     Aksine 0015'de lesson_duration_minutes/break zaten snapshot idi;
--     blocked_until snapshot deseni bu yapıya uyuyor.
--   * student_buffer_minutes integer — randevu başına snapshot. Öğretmen
--     ayarını değiştirse bile bu randevu için buffer değişmez.
-- ---------------------------------------------------------------------------
-- Güvenlik notları:
--   * Bu migration yalnızca nullable kolon ekler. Backfill ve NOT NULL 0021'de
--     (trigger güncellemesiyle aynı transaction içinde değil ama aynı
--     migration sırasında). Burada NOTHING KALICI YAPILMAZ; hata yakalama
--     kolonu nullable bırakır.
--   * Mevcut randevular için requested_start_time ve blocked_until NULL
--     kalabilir; 0021'de backfill: requested_start_time := (start_at at
--     timezone 'UTC')::time ve blocked_until := end_at (eski buffer
--     bilinmediğinden 0 kabul). Bu eski randevular için güvenli bir
--     yaklaşım: gerçek buffer geçmişte zaten kayboldu.
--   * RLS / politika değişikliği yok. appointments_active_slot_uniq
--     (0002:62) bu migration'da DOKUNULMAZ; 0021'de kaldırılacak (çakışma
--     kontrolü buffer'la birlikte partial unique ile yapılamaz çünkü
--     buffer dahil aralık sürekli değişebilir).
--   * Migration idempotent.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- A) Yeni kolonlar — nullable olarak başla
-- ===========================================================================
alter table public.appointments
    add column if not exists requested_start_time time;

alter table public.appointments
    add column if not exists student_buffer_minutes integer;

alter table public.appointments
    add column if not exists blocked_until timestamptz;

-- ===========================================================================
-- B) Kısıtlayıcılar (henüz NOT NULL değil; 0021 backfill + SET NOT NULL)
-- ===========================================================================
do $$
begin
    if not exists (
        select 1 from pg_constraint
         where conname = 'appointments_student_buffer_minutes_chk'
           and conrelid = 'public.appointments'::regclass
    ) then
        alter table public.appointments
            add constraint appointments_student_buffer_minutes_chk
                check (student_buffer_minutes is null
                       or (student_buffer_minutes >= 0
                           and student_buffer_minutes <= 120));
    end if;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_constraint
         where conname = 'appointments_blocked_until_order_chk'
           and conrelid = 'public.appointments'::regclass
    ) then
        alter table public.appointments
            add constraint appointments_blocked_until_order_chk
                check (blocked_until is null or blocked_until >= end_at);
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- Korunan unsurlar (dokunulmadı):
--   * appointments_active_slot_uniq (0002:62) — 0021'de kaldırılacak.
--   * appointments_insert_guard (0015) — 0021'de güncellenecek (öğretmen
--     ayarlarını profiles'tan okuyup requested_start_time'a göre start_at/
--     end_at/blocked_until türetecek + çakışma kontrolü ekleyecek).
--   * sync_availability_status (0003) — 0021'de 'booked' yazması kaldırılır.
--   * appointments_update_guard / appointments_delete_guard (0003) —
--     değiştirilmez.
--   * RLS politikaları (0002).
--   * notifications trigger (0008).
-- ---------------------------------------------------------------------------
