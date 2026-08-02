-- ============================================================
-- RLS Doğrulama ve Güvenlik Testleri (Adım 4 + 5.1)
-- ---------------------------------------------------------------------------
-- Dosya türü: SALT-OKU / güvenli doğrulama scripti
-- ---------------------------------------------------------------------------
-- Kurallar:
--   * Yalnızca SELECT ve güvenli-metadata sorguları içerir.
--   * Veri silen komut (DELETE / TRUNCATE / DROP) içermez.
--   * Veri ekleyen komut (INSERT) içermez.
--   * Veri güncelleyen komut (UPDATE) içermez.
--   * DDL komut (ALTER / DROP / CREATE) içermez.
--   * SET LOCAL ROLE / SET LOCAL request.jwt.claim.* yalnızca geçerli
--     oturum içindir; her test bloğu sonunda RESET ROLE ile sıfırlanır.
--   * Çalıştırma sonrası kalıcı etki bırakmaz.
-- ---------------------------------------------------------------------------
-- Kullanım:
--   Bu dosyayı Supabase SQL Editor'da manuel olarak, test amacıyla çalıştırın.
--   Otomatik CI/CD pipeline'ında çalıştırılması önerilmez; her testin
--   beklenen sonucu ilgili yorum satırında belirtilmiştir.
-- ---------------------------------------------------------------------------
-- UYARI: Bu dosyayı migration olarak ÇALIŞTIRMA. Migrations klasöründe
--        değil, tests/ klasöründedir. Supabase migration CLI bu dosyayı
--        otomatik uygulamaz.
-- ---------------------------------------------------------------------------
-- ADIM 5.1 GÜNCELLEMELERİ:
--   * TEST 3 düzeltildi: "hook" CTE ile en az iki öğrenci olmadan atlanır.
--   * TEST 4 yeniden düzenlendi: anonimve öğrenci olarak iki ayrı denetim.
--   * TEST 10 genişletildi: çakışan randevu senaryosu da kapsanır.
--   * TEST 11-14 eklendi: availability/appointments SELECT RLS.
--   * TEST 15-18 eklendi: availability/appointments INSERT/UPDATE/DELETE
--                         politika denetimleri.
--   * TEST 19 eklendi: anonim public_teacher_profiles erişim engeli.
--   * TEST 20-22 eklendi: fonksiyon & trigger gövde denetimleri.
-- ============================================================

-- ------------------------------------------------------------
-- HAZIRLIK 0: Geçerli oturum bilgisi
-- ------------------------------------------------------------
SELECT auth.uid() AS current_uid, auth.role() AS current_role;
-- Beklenen: TestRunner (genellikle service_role / postgres) uid ve rol görünmeli

-- ------------------------------------------------------------
-- HAZIRLIK 1: Testlerde kullanılacak kullanıcı özetleri
-- (Veri ekleme yok — yalnız mevcut kayıtlı kullanıcıları listeler)
-- ------------------------------------------------------------
SELECT u.id, u.email, p.role, u.created_at
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
ORDER BY u.created_at
LIMIT 50;
-- Beklenen: Testler için en az 1 öğrenci ve 1 öğretmen kaydı mevcut olmalı.
--          TEST 3 için en az 2 öğrenci olması gerekir (aşağıda "skip"
--          mekanizması ile az öğrenci durumunda güvenli atlanır).

-- ------------------------------------------------------------
-- HAZIRLIK 2: Test ön koşulu sayımları (planlama)
-- ------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.profiles WHERE role = 'student') AS student_count,
  (SELECT count(*) FROM public.profiles WHERE role = 'teacher') AS teacher_count,
  (SELECT count(*) FROM public.profiles)                                    AS profiles_count,
  (SELECT count(*) FROM public.availability)                               AS availability_count,
  (SELECT count(*) FROM public.appointments)                               AS appointments_count;
-- Beklenen: testlerin çoğu için student_count >= 1, teacher_count >= 1,
--          TEST 3 için student_count >= 2, TEST 13 için en az 2 öğretmen.

-- ------------------------------------------------------------
-- TEST 1: Anonim kullanıcı hiçbir profile erişememeli
-- ------------------------------------------------------------
SET LOCAL ROLE anon;

SELECT id, user_id FROM public.profiles LIMIT 5;
-- Beklenen: 0 satır — anonim erişim RLS ile engellenmiş olmalı

RESET ROLE;

-- ------------------------------------------------------------
-- TEST 2: Giriş yapan öğrenci yalnızca kendi profile kaydını okuyabilmeli
-- ------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = (
  SELECT id FROM public.profiles
  WHERE role = 'student'
  ORDER BY created_at
  LIMIT 1
);

SELECT id, user_id, role FROM public.profiles;
-- Beklenen: 1 satır — yalnızca öğrencinin kendi profili (user_id = auth.uid())

RESET ROLE;

-- ------------------------------------------------------------
-- TEST 3 (DÜZELTILDI): Öğrenci başka bir öğrencinin profile kaydını okuyamamalı
-- ---------------------------------------------------------------------------
-- Adım 5.1 düzeltmesi: Tek öğrenci varsa önceki sürüm yanıltıcı "1 satır"
-- dönebiliyordu (user1 = user2). Şimdi "hook" CTE ile en az 2 öğrenci yoksa
-- test güvenli şekilde atlanır ve -1 sentinel değeri döner; yorumdan nasıl
-- yorumlanacağı aşağıda verilmiştir.
-- ---------------------------------------------------------------------------
WITH student_pair AS (
  SELECT
    (SELECT id FROM public.profiles
      WHERE role = 'student'
      ORDER BY created_at ASC LIMIT 1)  AS first_uid,
    (SELECT id FROM public.profiles
      WHERE role = 'student'
      ORDER BY created_at DESC LIMIT 1) AS last_uid
),
probe AS (
  SELECT
    CASE
      WHEN sp.first_uid IS NULL OR sp.last_uid IS NULL
        OR sp.first_uid = sp.last_uid
      THEN -1   -- ön koşul sağlanmıyor: atlandı
      ELSE 0
    END AS skip_flag,
    sp.first_uid,
    sp.last_uid
  FROM student_pair sp
)
SELECT
  p.skip_flag,
  p.first_uid   AS target_profile_uid,
  p.last_uid    AS acting_as_uid
FROM probe p;
-- Beklenen:
--   * skip_flag = -1  -> en az 2 öğrenci yok; TEST 3 anlamlı değil, atlandı
--   * skip_flag =  0  -> iki farklı öğrenci var; aşağıdaki lambe sorguyu koş

-- Yalnızca iki farklı öğrenci varsa erişim reddini doğrula. Tek öğrenci
-- senaryosunda auth.uid() = target olduğu için bu blok doğrudan benze şekilde
-- güvenli atlanır (aşağıdaki "guard" CTE ile).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = (
  SELECT u2.id FROM public.profiles u2
  WHERE u2.role = 'student'
  ORDER BY u2.created_at DESC
  LIMIT 1
);

WITH guard AS (
  SELECT
    (SELECT count(*) FROM public.profiles
      WHERE role = 'student') AS n_students,
    (SELECT id FROM public.profiles
      WHERE role = 'student'
      ORDER BY created_at ASC LIMIT 1) AS first_uid,
    (SELECT id FROM public.profiles
      WHERE role = 'student'
      ORDER BY created_at DESC LIMIT 1) AS last_uid
)
SELECT
  CASE
    WHEN g.n_students < 2 OR g.first_uid IS NULL OR g.last_uid IS NULL
      OR g.first_uid = g.last_uid
    THEN NULL  -- ön koşul sağlanmıyor; gösterilecek satır yok
    ELSE p.user_id
  END AS visible_user_id
FROM public.profiles p
CROSS JOIN guard g
WHERE g.n_students >= 2
  AND g.first_uid <> g.last_uid
  AND p.user_id = g.first_uid;
-- Beklenen:
--   * En az 2 öğrenci varsa: 0 satır — farklı öğrencinin profili görünmemeli
--   * 2 öğrenci yoksa: 0 satır döner (WHERE bypass) — test koşullu atlandı;
--     yorum olarak "2 öğrenci gerekir" notuyla manuel teyit edilmeli

RESET ROLE;

-- ------------------------------------------------------------
-- TEST 4 (DÜZENLENDI): Öğrenci public_teacher_profiles listesini okuyabilmeli
-- ------------------------------------------------------------
-- TestRunner (service_role) ileメーカー halka açık görünüm erişimi
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = (
  SELECT id FROM public.profiles
  WHERE role = 'student'
  ORDER BY created_at
  LIMIT 1
);

SELECT count(*) AS teacher_profiles_visible_to_student
FROM public.public_teacher_profiles;
-- Beklenen: >0 — öğrenci halka açık öğretmen listesini görebilmeli

RESET ROLE;

-- ------------------------------------------------------------
-- TEST 5: public_teacher_profiles içinde phone alanı bulunmadığını doğrula
-- ------------------------------------------------------------
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'public_teacher_profiles'
  AND column_name = 'phone';
-- Beklenen: 0 satır — phone kolonu bu görünümde olmamalı

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'public_teacher_profiles'
ORDER BY ordinal_position;
-- Beklenen: phone kolonu listede olmamalı; yalnızca id, full_name, role,
--          created_at türü güvenli kolonlar yer almalı

-- ------------------------------------------------------------
-- TEST 6: Öğrenci teacher rolüne geçmeye çalıştığında reddedildiği doğrula
-- ------------------------------------------------------------
-- UPDATE çalıştırmadan, RLS update politikası + trigger denetimi ile doğrula
SELECT polname, polcmd,
       pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check
FROM pg_policy
WHERE polrelid = 'public.profiles'::regclass
  AND polcmd IN ('u','*');
-- Beklenen: update using/with_check ifadesinde id = auth.uid() kısıtı olmalı;
--          role değişikliği politikada değil, BEFORE UPDATE trigger'da engellenir

-- profiles_before_update_guard fonksiyon gövdesi: role değişikliği raise exception
SELECT pg_get_functiondef('public.profiles_before_update_guard()'::regprocedure) AS def;
-- Beklenen: "role is distinct from old.role" -> raise exception satırı olmalı

-- ------------------------------------------------------------
-- TEST 7: Öğretmen başka bir öğretmenin profilini değiştirememeli
-- ------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = (
  SELECT u.id FROM public.profiles u
  WHERE u.role = 'teacher'
  ORDER BY u.created_at ASC
  LIMIT 1
);

-- Öğretmen olarak yalnızca kendi profilini görebilmeli
SELECT count(*) AS visible_to_this_teacher
FROM public.profiles
WHERE role = 'teacher';
-- Beklenen: 1 — yalnızca kendi öğretmen profili görünür

-- Update politika denetimi (TEST 6 ile aynı politika grubu)
SELECT polname, polcmd,
       pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check
FROM pg_policy
WHERE polrelid = 'public.profiles'::regclass
  AND polcmd IN ('u','*');
-- Beklenen: update using/with_check ifadesinde id = auth.uid() kısıtı olmalı;
--          dolayısıyla başka öğretmenin satırı "using" koşuluna takılır

RESET ROLE;

-- ------------------------------------------------------------
-- TEST 8: Randevu oluşturma RLS kurallarını doğrula
-- ------------------------------------------------------------
-- appointments tablosu için INSERT politikalarını incele
SELECT schemaname, tablename, policyname, permissive, roles,
       cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'appointments'
  AND cmd IN ('INSERT','ALL');
-- Beklenen: INSERT politikasında student_id = auth.uid() ve rol=student kontrolü
--          bulunmalı; başkası adına randevu eklenememeli

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'appointments'
ORDER BY ordinal_position;
-- Beklenen: student_id, teacher_id, slot_id, status, ... kolonları yer almalı

-- ------------------------------------------------------------
-- TEST 9: Aynı slot için ikinci randevu oluşturulamadığını doğrula
-- ------------------------------------------------------------
-- INSERT çalıştırmadan mevcut kısıtları denetle
SELECT con.conname, pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname = 'appointments'
  AND con.contype IN ('u','c','x');
-- Beklenen: slot_id + status='pending'|'confirmed' üzerine partial uniq index olmalı

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'appointments';
-- Beklenen: appointments_active_slot_uniq benzeri bir unique partial index olmalı

-- BEFORE INSERT trigger: appointments_insert_guard -> slot status='open' ve rol=student
SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'public.appointments'::regclass
  AND NOT tgisinternal
  AND tgname = 'appointments_insert_guard_trg';
-- Beklenen: BEFORE INSERT trigger mevcut; içinde slot status='open' kontrolü

SELECT pg_get_functiondef('public.appointments_insert_guard()'::regprocedure) AS def;
-- Beklenen: v_slot_status <> 'open' ise raise exception satırı olmalı

-- ------------------------------------------------------------
-- TEST 10 (GENISLETILDI): Slot iptal edilince availability.status tekrar open oluyor mu doğrula
-- ---------------------------------------------------------------------------
-- Adım 5.1 düzeltmesi: Yalnız "cancelled -> open" senaryosunu değil, çakışan
-- randevu senaryosunu da kapsar. sync_availability_status fonksiyonu iptal
-- sırasında aynı slot'ta hâlâ aktif (pending/confirmed) randevu varsa slot'u
-- 'open' YAPMAMALIDIR.
-- ---------------------------------------------------------------------------

-- 10a. Appointment trigger'larının listesi
SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'public.appointments'::regclass
  AND NOT tgisinternal;
-- Beklenen:
--   * appointments_insert_guard_trg  (BEFORE INSERT)
--   * appointments_update_guard_trg (BEFORE UPDATE)
--   * appointments_delete_guard_trg (BEFORE DELETE)
--   * appointments_sync_availability_ai (AFTER INSERT)
--   * appointments_sync_availability_au (AFTER UPDATE, when status değişti)
--   * appointments_sync_availability_ad (AFTER DELETE)

-- 10b. sync_availability_status fonksiyon gövdesinin denetimi
SELECT pg_get_functiondef('public.sync_availability_status()'::regprocedure) AS def;
-- Beklenen:
--   * TG_OP='UPDATE' && new.status='cancelled' dalında
--     v_active_count := count(*) from appointments where slot_id=new.slot_id
--                       and status in ('pending','confirmed') and id <> new.id
--   * v_active_count = 0 ise sadece o zaman slot -> 'open'
--   * Çakışan aktif randevu varsa slot 'booked' kalmalı

-- 10c. Mevcut "cancelled" randevular ve ilgili slot durumu
SELECT a.id AS appointment_id,
       a.status AS appointment_status,
       a.slot_id,
       av.status AS slot_status,
       (SELECT count(*) FROM public.appointments a2
         WHERE a2.slot_id = a.slot_id
           AND a2.status IN ('pending','confirmed')
           AND a2.id <> a.id) AS still_active_on_same_slot
FROM public.appointments a
LEFT JOIN public.availability av ON av.id = a.slot_id
WHERE a.status = 'cancelled'
LIMIT 20;
-- Beklenen:
--   * still_active_on_same_slot = 0  -> slot_status = 'open' olmalı
--   * still_active_on_same_slot > 0  -> slot_status = 'booked' kalmalı
--   * WIDE-OR: cancelled appointment hiç yoksa 0 satır döner; yorumla:
--     "Bu senaryoyu doğrulamak için veri yok" notuyla manuel ekleme gerekir.

-- 10d. Çakışan senaryo için veri gereksinim sayımı
SELECT
  (SELECT count(*) FROM public.appointments
    WHERE status = 'cancelled') AS cancelled_count,
  (SELECT count(*) FROM public.appointments a
    WHERE a.status = 'cancelled'
      AND EXISTS (
        SELECT 1 FROM public.appointments a2
        WHERE a2.slot_id = a.slot_id
          AND a2.status IN ('pending','confirmed')
          AND a2.id <> a.id
      )) AS cancelled_with_active_sibling;
-- Beklenen:
--   * cancelled_with_active_sibling > 0 ise cross-check için veri mevcut;
--     bu durumda yukarıdaki 10c sorgusu çakışan senaryoyu doğrular.
--   * cancelled_with_active_sibling = 0 ise çakışan senaryo test için
--     yeterli veri yok; manuel test verisi (silme yapılmadan) eklenmeli.

-- ------------------------------------------------------------
-- TEST 11: Öğrenci başkasının randevusunu göremez (appointments SELECT RLS)
-- ------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = (
  SELECT id FROM public.profiles
  WHERE role = 'student'
  ORDER BY created_at
  LIMIT 1
);

SELECT count(*) AS visible_appointments
FROM public.appointments;
-- Beklenen: yalnızca student_id = auth.uid() olan randevular görünür

SELECT count(*) AS own_appointments
FROM public.appointments
WHERE student_id = auth.uid();
-- Beklenen: visible_appointments = own_appointments
--          (başka öğrenci randevuları görünmemeli)

RESET ROLE;

-- ------------------------------------------------------------
-- TEST 12: Öğretmen yalnızca kendi randevularını görür (appointments SELECT RLS)
-- ------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = (
  SELECT u.id FROM public.profiles u
  WHERE u.role = 'teacher'
  ORDER BY u.created_at ASC
  LIMIT 1
);

SELECT count(*) AS visible_appointments
FROM public.appointments;
-- Beklenen: yalnızca teacher_id = auth.uid() olan randevular görünür

SELECT count(*) AS own_appointments
FROM public.appointments
WHERE teacher_id = auth.uid();
-- Beklenen: visible_appointments = own_appointments

RESET ROLE;

-- ------------------------------------------------------------
-- TEST 13: Anonim kullanıcı appointments ve availability tablolarını göremez
-- ------------------------------------------------------------
SET LOCAL ROLE anon;

SELECT count(*) AS anon_appointments FROM public.appointments;
-- Beklenen: 0 — anonim erişim RLS ile engellenmiş olmalı

SELECT count(*) AS anon_availability FROM public.availability;
-- Beklenen: 0 — anonim erişim RLS ile engellenmiş olmalı

RESET ROLE;

-- ------------------------------------------------------------
-- TEST 14: availability SELECT RLS — öğretmen başka öğretmenin slotunu göremez
-- ------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = (
  SELECT u.id FROM public.profiles u
  WHERE u.role = 'teacher'
  ORDER BY u.created_at ASC
  LIMIT 1
);

SELECT count(*) AS visible_slots
FROM public.availability;
-- Beklenen: bu öğretmenin yalnızca kendi slotlarını görür.
--          UYARI: availability_read_policy using(true) ise her authenticated
--          tüm slotları görebilir. Bu beklenen davranış dokümantasyona bağlıdır:
--          - Open slotlar herkese açıksa: >0
--          - Yalnız kendi slotları görülmeli ise: yalnız teacher_id=auth.uid() sayısı
--          Migration 0001'de using(true) kullanıldığı için burada >0 dönebilir.
--          Politika davranışı aşağıda 15'inci test ile çapraz doğrulanır.

SELECT count(*) AS own_slots
FROM public.availability
WHERE teacher_id = auth.uid();
-- Beklenen: visible_slots >= own_slots (using(true) ise eşit veya daha büyük)

-- İkinci öğretmenin slotlarını ayrı bir sorguda say:
SET LOCAL request.jwt.claim.sub = (
  SELECT u.id FROM public.profiles u
  WHERE u.role = 'teacher'
  ORDER BY u.created_at DESC
  LIMIT 1
);
SELECT count(*) AS own_slots_second_teacher
FROM public.availability
WHERE teacher_id = auth.uid();
-- Beklenen: ikinci öğretmenin kendi slot sayısı

RESET ROLE;

-- ------------------------------------------------------------
-- TEST 15: availability INSERT / UPDATE / DELETE politika doğrulama
-- ------------------------------------------------------------
SELECT schemaname, tablename, policyname, permissive, roles,
       cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'availability'
ORDER BY cmd;
-- Beklenen:
--   * SELECT -> authenticated, using(true)
--   * INSERT -> authenticated, with check: teacher_id = auth.uid() AND role='teacher'
--   * UPDATE -> authenticated, using/with check: teacher_id = auth.uid()
--   * DELETE -> authenticated, using: teacher_id = auth.uid()

-- ------------------------------------------------------------
-- TEST 16: appointments INSERT / UPDATE / DELETE politika doğrulama
-- ------------------------------------------------------------
SELECT schemaname, tablename, policyname, permissive, roles,
       cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'appointments'
ORDER BY cmd;
-- Beklenen:
--   * SELECT -> authenticated, using: student_id=auth.uid() OR teacher_id=auth.uid()
--   * INSERT -> authenticated, with check: student_id=auth.uid() AND role='student'
--   * UPDATE -> authenticated, using/with check: student_id=auth.uid() OR teacher_id=auth.uid()
--   * DELETE -> authenticated, using: student_id=auth.uid()

-- ------------------------------------------------------------
-- TEST 17: profiles INSERT/DELETE politika denetimi (olmaması beklenir)
-- ------------------------------------------------------------
SELECT schemaname, tablename, policyname, permissive, roles,
       cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'profiles'
ORDER BY cmd;
-- Beklenen:
--   * SELECT -> authenticated, using: id = auth.uid()
--   * UPDATE -> authenticated, using/with check: id = auth.uid()
--   * INSERT politika YOK — signup trigger ile oluşturulur
--   * DELETE politika YOK — kullanıcı kendi profilini silemez

-- ------------------------------------------------------------
-- TEST 18: appointments BEFORE UPDATE trigger gövde denetimi (status geçişleri)
-- ------------------------------------------------------------
SELECT pg_get_functiondef('public.appointments_update_guard()'::regprocedure) AS def;
-- Beklenen:
--   * Öğrenci yalnızca: pending->cancelled, confirmed->cancelled
--   * Öğretmen yalnızca: pending->confirmed, pending|confirmed->cancelled,
--                        confirmed->completed
--   * Diğer aktörler işleme '42501' yetkisiz erişim hatası

-- ------------------------------------------------------------
-- TEST 19 (YENI): Anonim kullanıcının public_teacher_profiles erişim engeli
-- ---------------------------------------------------------------------------
-- Migration 0003:143'te "grant select ON public.public_teacher_profiles
-- TO authenticated" kullanıldı. Anonim rolün select hakkı yoktur; RLS
-- dışında grant düzeyinde de denetlenmesi gerekir.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;

SELECT count(*) AS anon_visible_teacher_profiles
FROM public.public_teacher_profiles;
-- Beklenen:
--   * permission denied / 0 satır — anonim erişim reddedilmeli
--   * Eğer >0 satır dönüyorsa: kritik güvenlik açığı; grant'in yeniden gözden
--     geçirilmesi gerekir (TO authenticated yerine TO public verilmiş olabilir)

RESET ROLE;

-- ------------------------------------------------------------
-- TEST 20: get_teacher_profiles() fonksiyon imzasında phone yok
-- ------------------------------------------------------------
SELECT pg_get_functiondef('public.get_teacher_profiles()'::regprocedure) AS def;
-- Beklenen:
--   * RETURNS TABLE (id uuid, full_name text, role text, created_at timestamptz)
--   * phone kolonu YOK
--   * SECURITY DEFINER, set search_path = public
--   * GRANT EXECUTE TO authenticated; PUBLIC'ten REVOKE

-- ------------------------------------------------------------
-- TEST 21: handle_new_user trigger'ı profili student olarak oluşturuyor mu
-- ------------------------------------------------------------
SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) AS def;
-- Beklenen:
--   * insert into public.profiles (id, full_name, phone, role)
--     values (new.id, ..., 'student')
--   * role her zaman 'student' olarak set edilmeli

SELECT pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'auth.users'::regclass
  AND NOT tgisinternal
  AND tgname = 'on_auth_user_created';
-- Beklenen: AFTER INSERT ON auth.users, FOR EACH ROW, handle_new_user()

-- ------------------------------------------------------------
-- TEST 22: appointments BEFORE DELETE trigger gövde denetimi
-- ------------------------------------------------------------
SELECT pg_get_functiondef('public.appointments_delete_guard()'::regprocedure) AS def;
-- Beklenen:
--   * v_actor IS NULL veya v_actor <> old.student_id -> raise '42501'
--   * old.status <> 'pending' -> raise (yalnızca pending iken silinebilir)

-- ------------------------------------------------------------
-- Test sonrası temizlik: oturum değişkenlerini sıfırla
-- ------------------------------------------------------------
RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';
-- Beklenen: tüm geçici oturum değişkenleri temizlenmiş;
--          sonraki komutlar etkilenmemeli

-- Son özet
SELECT 'RLS test suite (Adım 5.1) hazır — çalıştırma için kullanıcı onayı bekleniyor' AS status;
-- Beklenen: status satırı tek satır dönmeli
