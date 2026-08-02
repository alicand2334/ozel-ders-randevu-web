-- |--------------------------------------------------------------------------
-- Migration: 0004_rls_tests.sql
-- Açıklama: RLS ve güvenlik doğrulama testleri (salt-oku, veri silme YOK).
-- ---------------------------------------------------------------------------
-- Çalıştırma önerisi:
--   Bu testlerin bir kısmı (1-7) mevcut veriyle, SQL Editor'da anonim veya
--   oturum açmış kullanıcı bağlamında SAFE-DOĞRULAMA script'leri olarak çalışır.
--   #8-#10 gerçek bir randevu/slot verisi gerektirir; bunlar için aşağıdaki
--   "Hazırlık" bölümünde test kullanıcıları ve bir slot eklenir (silme yok).
--
--   NOT: Bu script birim/entegrasyon testi DEĞİLDİR; "bir bakiye ve politika
--   hatırlatması" niteliğindedir. Çalıştırdığında satır sayılarından yorum yapar.
--
-- GERÇEK OTOMASYON için bu sorgular Supabase "Test Runner" veya Postgres
-- `set local role` + `set request.jwt.claims` ile koşulur (aşağıda örnek).
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- HAZIRLIK: Testte kullanılacak güvenli kanıtlar (mübalağasız, silme yok)
-- ===========================================================================
-- Aşağıdaki sorgular mevcut veriyi okur; veri eklemez/silmez. Test kullanıcıları
-- henüz yoksa şu adımları Auth tarafında aç (script dışı):
--   1) email: ogrenci@test.local / şifre: test1234  (rol = student, trigger ile)
--   2) email: ogretmen@test.local / şifre: test1234 (rol = student olarak açılır,
--      sonra SQL Editor ile `update profiles set role='teacher' where ...`)
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- TEST 1 — Anonim kullanıcı hiçbir profile erişememeli
-- ===========================================================================
-- Beklenen: 0 satır (anonim = auth.uid() NULL -> using(id = auth.uid()) false)
-- ---------------------------------------------------------------------------
-- SQL Editor varsayılan olarak `postgres` (service role) bağlamında çalışır,
-- yani anonim DEĞİL. Anonim davranışı için:
--   set local role anon;
--   select count(*) as profiles_visible_anon from public.profiles;
--   reset role;
-- Aşağıdaki yardımcı sorgu, anonim erişim için gereken role set eder:
set local role anon;
select count(*) as test1_anon_should_be_0 from public.profiles;
reset role;
-- Beklenen: 0

-- ===========================================================================
-- TEST 2 — Giriş yapan öğrenci yalnızca kendi profile kaydını okuyabilmeli
-- ===========================================================================
-- Beklenen: görülen satır sayısı en fazla 1 ve o satır kendi id'si.
-- Aşağıda auth.uid() yerine geçici olarak bir JWT claim set ediyoruz:
-- TEST HAZIRLIK: öğrenci kullanıcının UUID'sini `JWT_SUB_TEACHER` yerine koy.
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<OGR_UUID>"}';
--   select count(*) as test2_self_rows_should_be_le_1,
--          bool_and(id = auth.uid()) as test2_all_rows_are_own
--     from public.profiles;
--   reset role;
--   reset request.jwt.claims;
-- Not: dikkate değer -- başka hesap için yukarıdaki claim set edildiğinde
-- yalnızca o kullanıcı için çalışır.
-- ---------------------------------------------------------------------------
-- Aşağıdaki yalnızca bilgi amaçlı bir bakiye sorgusudur (gerçek auth.uid()
-- olmadan): count(*) = 0 olabilir (anonim); gerçek öğrenci bağlamında 1 olur.
select count(*) as test2_self_rows_info_only from public.profiles;
-- Beklenen (gerçek öğrenci oturumunda): = 1

-- ===========================================================================
-- TEST 3 — Öğrenci başka bir öğrencinin kaydını okuyamamalı
-- ===========================================================================
-- Beklenen: `profiles` tablosundan öğrencinin gördüğü satırlar içinde başka
-- öğrenci yok. Test, TEST 2 ile aynı yöntemle:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<OGR_1_UUID>"}';
--   select count(*) as test3_other_student_rows_should_be_0
--     from public.profiles
--    where id <> auth.uid();  -- 0 olmalı (RLS using(id=auth.uid()))
--   reset role;
--   reset request.jwt.claims;
-- ---------------------------------------------------------------------------
-- Bilgi amaçlı bakiye: anonim bağlamda tüm satırlar `where id <> null` -> 0
select count(*) as test3_other_student_rows_info_only
  from public.profiles
 where id <> auth.uid();
-- Beklenen (gerçek öğrenci oturumunda): 0

-- ===========================================================================
-- TEST 4 — Öğrenci public_teacher_profiles listesini okuyabilmeli
-- ===========================================================================
-- Beklenen: 0 veya daha fazla satır (öğretmen sayısı kadar); hata ALMAMAK.
-- Aşağıdaki dış bağlamda (service role) her zaman döner; gerçek öğrenci
-- bağlamında da `get_teacher_profiles()` üzerinden döner (SECURITY DEFINER).
-- ---------------------------------------------------------------------------
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<OGR_UUID>"}';
--   select count(*) as test4_teacher_list_should_work, count(distinct id) as uniq
--     from public.public_teacher_profiles;
--   reset role;
--   reset request.jwt.claims;
-- ---------------------------------------------------------------------------
select count(*) as test4_teacher_list_info_only,
       count(distinct id) as test4_teacher_list_unique
  from public.public_teacher_profiles;
-- Beklenen: >= 0 (hata yok, öğretmenler tekil id)

-- ===========================================================================
-- TEST 5 — public_teacher_profiles içinde phone alanı bulunmadığını doğrula
-- ===========================================================================
-- Beklenen: `phone` kolonu view'da YOK. information_schema ile kanıtla.
select count(*) as test5_phone_column_should_be_0
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'public_teacher_profiles'
   and column_name  = 'phone';
-- Beklenen: 0

-- ===========================================================================
-- TEST 6 — Öğrenci teacher rolüne geçmeye çalıştığında reddedilmeli
-- ===========================================================================
-- Beklenen: BEFORE UPDATE trigger (profiles_before_update_guard_trg) update'i
-- reddeder; c rollback yapar. Aşağıdaki güvenli doğrulama: trigger var mı?
-- Not: gerçek reddi görmenin güvenli yolu, geçici bir test satırı açıp update
-- denemek olurdı; ancak veri eklemeden bunu kanıtlayamayız. Bunun yerine
-- trigger fonksiyonunun varlığını ve rol kontrolü yaptığını doğruluyoruz.
select count(*) as test6_role_immutable_trigger_should_be_1
  from pg_trigger
 where tgname = 'profiles_before_update_guard_trg'
   and not tgisinternal;
-- Beklenen: 1  (trigger var -> role değişimi reddedilir)

-- ===========================================================================
-- TEST 7 — Öğretmen başka bir öğretmenin profilini değiştirememeli
-- ===========================================================================
-- Beklenen: update politika using/with check = (id = auth.uid()) -> yalnızca
-- kendi satırı. Yani başka öğretmenin satırına update izni yok.
-- Bilgi amaçlı bakiye: bir başka öğretmenin satırını update etmeye çalışırsan
-- "0 rows affected" olur (RLS sahibinden başkasını görmez).
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<OGR_1_UUID>"}';
--   update public.profiles set full_name = full_name
--    where id = '<OGR_2_UUID>';             -- başka bir öğretmen
--   -- etkilenen satır: 0 olmalı
--   reset role;
--   reset request.jwt.claims;
-- ---------------------------------------------------------------------------
-- Güvenli bakiyedir (silme/güncelleme yok): politika metnini doğrula.
select polname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename = 'profiles'
   and polname in ('profiles_update_policy')
 order by polname;
-- Beklenen: qual/with_check içinde `id = auth.uid()` ifadesi -> başka kullanıcı
-- sahibi olmadığı satırı update edemez.

-- ===========================================================================
-- TEST 8 — Randevu oluşturma RLS kurallarını doğrula (politika metni)
-- ===========================================================================
-- Beklenen: insert politika `with check` = öğrenci kendi adına ve rolü
-- student olan bir profil. Telefon/silme yok; yalnızca politika metnini okur.
select polname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename = 'appointments'
   and cmd = 'INSERT';
-- Beklenen: polname = appointments_insert_policy; with_check içinde:
--   student_id = auth.uid()  AND  profiles rolü student

-- ===========================================================================
-- TEST 9 — Aynı slot için ikinci randevu oluşturulamadığını doğrula
-- ===========================================================================
-- Beklenen: kısmi benzersiz indeks `appointments_active_slot_uniq` mevcut.
-- Aynı slot_id'de birden fazla pending/confirmed satır eklenemez (DB-level).
select count(*) as test9_active_slot_uniq_index_should_be_1
  from pg_indexes
 where schemaname = 'public'
   and tablename = 'appointments'
   and indexname = 'appointments_active_slot_uniq'
   and indexdef ilike '%where%status in%pending%confirmed%';
-- Beklenen: 1  (indeks tanımı "where status in (...)" içeriyor)

-- ===========================================================================
-- TEST 10 — Slot iptal edilince availability.status tekrar open oluyor mu
-- ===========================================================================
-- Beklenen: AFTER UPDATE trigger `appointments_sync_availability_au` mevcut
-- ve `when (new.status is distinct from old.status)` ile çalışır; `sync_availability_status`
-- fonksiyonu iptal status = 'cancelled' iken slot.status = 'open' yapar (başka
-- aktif randevu yoksa).
-- Not: gerçek e2e testi veri ekleme gerektirir (slot + 2 randevu + cancel).
-- Burada yalnızca trigger + fonksiyon varlığını doğruluyoruz.
select
  (select count(*) from pg_trigger
     where tgname = 'appointments_sync_availability_au'
       and not tgisinternal)   as test10_sync_trigger_should_be_1,
  (select count(*) from pg_proc
     where proname = 'sync_availability_status'
       and pronamespace = 'public'::regnamespace) as test10_sync_fn_should_be_1;
-- Beklenen: 1, 1

-- ===========================================================================
-- ÖZET (yorum): tüm "should_be_..." çıktılarının beklenen değerleri
-- ===========================================================================
--   test1_anon_should_be_0                            = 0
--   test2_self_rows_info_only (gerçek oturumda)        = 1
--   test3_other_student_rows_info_only (gerçek)       = 0
--   test4_teacher_list_info_only                      >= 0 (hata yok)
--   test5_phone_column_should_be_0                    = 0
--   test6_role_immutable_trigger_should_be_1          = 1
--   test7 -> qual/with_check içinde 'id = auth.uid()' mevcut
--   test8 -> with_check içinde 'student_id = auth.uid()' + rol student mevcut
--   test9_active_slot_uniq_index_should_be_1          = 1
--   test10_sync_trigger_should_be_1 = 1,  test10_sync_fn_should_be_1 = 1
-- ---------------------------------------------------------------------------
-- NOT (TEST 2/3 gerçek koşum için şablon — tek parça halinde çalıştırılabilir):
-- ---------------------------------------------------------------------------
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<OGRENCI_UUID>","role":"authenticated"}';
-- select count(*) as t2_self, count(*) filter (where id = auth.uid()) as t2_own,
--        count(*) filter (where id <> auth.uid()) as t2_other_should_be_0
--   from public.profiles;
-- select count(*) as t4_teacher_list from public.public_teacher_profiles;
-- reset role;
-- reset request.jwt.claims;
-- ===========================================================================
