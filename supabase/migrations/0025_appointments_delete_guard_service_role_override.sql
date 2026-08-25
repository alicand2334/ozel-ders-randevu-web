-- |--------------------------------------------------------------------------
-- Migration: 0025_appointments_delete_guard_service_role_override.sql
-- Açıklama:
--   public.appointments_delete_guard() BEFORE DELETE trigger fonksiyonunu
--   yeniden tanımlar: GERÇEK bir Supabase service_role isteğinde (PostgREST
--   bağlamının aktif Postgres rolü = 'service_role') silme guard'ı atlanır;
--   aksi halde mevcut davranış (yalnızca old.student_id = auth.uid() ve
--   status = 'pending') aynen korunur.
--
--   Sorun:
--     0024_service_role_delete_grants.sql, service_role'e public.appointments
--     üzerinde tablo seviyesinde DELETE yetkisi verdi (PostgREST 42501
--     "permission denied" hatasını gidermek için). Ancak 0003'te tanımlanan
--     appointments_delete_guard() BEFORE DELETE trigger'ı service_role
--     bağlamını dikkate almıyor: auth.uid() NULL döner ve fonksiyon
--     deterministic olarak `raise exception 'Bu randevuyu silme yetkiniz yok.'
--     using errcode = '42501'` fırlatıyor. Bu, admin panelinin "Kalıcı Sil"
--     akışının (src/app/api/admin/teachers/[id]/route.ts DELETE; service_role
--     client ile admin.from("appointments").delete().eq("teacher_id", tid))
--     adım 1 onwards'ını engelliyor (0024'te açılan GRANT'a rağmen).
--
--   Çözüm:
--     Bypass yalnızca gerçek Supabase service_role bağlamına özeldir. Bunu
--     belirlemek için auth.uid() IS NULL veya auth.jwt() ->> 'role' kontrolleri
--     KULLANILMAZ. Sebep:
--       1) auth.uid() IS NULL — anon, SQL Editor (postgres rolü) ve diğer
--          UID'siz Postgres bağlamlarında da true olur (0012_first_admin_
--          bootstrap.sql:10 notunda teyit edildi).
--       2) auth.jwt() ->> 'role' = 'service_role' — yalnızca legacy JWT-based
--          service_role anahtarları için güvenilir. Bu projedeki
--          SUPABASE_SERVICE_ROLE_KEY yeni nesil sb_secret_... formatında
--          (.env.local: <secret>); secret key
--          JWT DEĞILDIR (Supabase docs: "As the publishable and secret keys
--          are no longer JWT-based..."). PostgREST bu anahtarı `apikey`
--          header'ından tanır, `authenticator` rolüyle bağlanır ve bağlamı
--          gerçek `service_role` Postgres rolüne "change into" yapar; bu
--          sırada auth.jwt() NULL döner -> eski JWT-claim kontrolü false
--          olur ve bypass çalışmazdı.
--     Supabase docs (api-keys): "Secret keys authorize access to your
--     project's data via the built-in service_role Postgres role." Yani tek
--     güvenilir belirteç, o an çalışan Postgres rolünün birebir 'service_role'
--     olmasıdır. PostgREST supabase-js'in `apikey: <sb_secret_...>` ile gelen
--     isteğini tanıyınca `SET LOCAL ROLE service_role` uygular; bu durumda
--     `current_user` built-in fonksiyonu 'service_role' döner.
--
--     Kullanılan kontrol:
--       if current_user = 'service_role' then
--           return old;
--       end if;
--     - current_user: o anki fonksiyon çağrısının aktif rolü (SET ROLE'den
--       etkilenir). appointments_delete_guard() SECURITY DEFINER değildir
--       (0003 varsayılan: SECURITY INVOKER) -> trigger, çağıran bağlamın
--       rolünde çalışır; current_user, PostgREST'in switch ettiği rolü verir.
--     - session_user KULLANILMAZ: o bağlantıyı açan rol (authenticator) verir
--       ve SET ROLE'den etkilenmez -> her zaman 'authenticator' döner, işe
--       yaramaz.
--     - pg_has_role(current_user, 'service_role', 'member')
--       KULLANILMAZ: bu, postgres superuser gibi ayrıcalıklı rolleri de
--       service_role üyesi sayabilir -> SQL Editor'da yanlışça bypass'a yol
--       açar. Strict equality (current_user = 'service_role') yalnızca gerçek
--       PostgREST service_role bağlamını yakalar; postgres, supabase_admin,
--       dashboard_user, supabase_auth_admin gibi roller için false döner.
--
--   Güvenlik notları:
--     - Bypass yalnızca service_role Postgres rolüne özeldir. Bu rol
--       yalnızca sunucu tarafında kullanılır (src/app/api/admin/** route
--       handler'ları, src/lib/supabase/server-client.ts: createServiceClient
--       -> SUPABASE_SERVICE_ROLE_KEY env var). sb_secret_... anahtarı
--       istemciye ifşa edilmez; tarayıcı yaklaşımları Supabase tarafından
--       HTTP 401 ile reddedilir (docs: "secret key will always reply with
--       HTTP 401 Unauthorized in browser").
--     - Normal authenticated kullanıcılar (student/teacher/admin RLS bağlamı)
--       -> PostgREST `SET LOCAL ROLE authenticated` uygular -> current_user =
--       'authenticated' -> bypass koşulu false; eski davranış birebir
--       korunur (yalnızca kendi pending randevularını silebilir, 42501/P0003
--       hataları aynen fırlatılır).
--     - anon rolü -> PostgREST `SET LOCAL ROLE anon` uygular -> current_user
--       = 'anon' -> bypass false. anon EK OLARAK public.appointments üzerinde
--       tablo seviyesinde DELETE yetkisine de sahip değildir (0014/0024
--       yalnızca service_role ve profiles'a GRANT verdi) ve RLS
--       politikaları authenticated-only olduğundan anon policy seviyesinde de
--       dışlanır. Dolayısıyla anon için bypass KESİNLİKLE olmaz.
--     - SQL Editor / postgres bağlamı: current_user = 'postgres' (veya
--       dashboard_user) -> bypass false; guard yanlışlıkla bypass edilmez.
--       Önceki taslakların auth.uid() IS NULL veya auth.jwt() ->> 'role'
--       pattern'lerinin aksine, tek başına UID-NULL veya JWT-claim
--       bulunamaması bypass anlamına gelmez; gerçek Postgres rolü esas alınır.
--     - Hiçbir RLS politikası, FOREIGN KEY, ON DELETE davranışı, diğer
--       trigger (appointments_insert_guard_trg, appointments_update_guard_trg,
--       appointments_sync_availability_*, appointment_notifications_*),
--       CHECK constraint veya GRANT değiştirilmez. Yalnızca BEFORE DELETE
--       guard'ının fonksiyon gövdesi REPLACE edilir; trigger kendisi
--       (appointments_delete_guard_trg) korunduğu için yeniden oluşturulmaz.
--     - Migration idempotent (create or replace function).
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.appointments_delete_guard() -> 0003_triggers_functions.sql
--   appointments_delete_guard_trg       -> 0003 (korunur, dokunulmaz)
--   service_role DELETE yetkisi         -> 0024 (korunur, dokunulmaz)
--   current_user built-in               -> PostgreSQL çekirdek (pg_catalog)
-- ---------------------------------------------------------------------------

create or replace function public.appointments_delete_guard()
returns trigger
language plpgsql
as $$
declare
    v_actor uuid := auth.uid();
begin
    -- Yalnızca GERÇEK Supabase service_role Postgres rolü bypass alır.
    -- PostgREST sb_secret_... anahtarı (veya legacy service_role JWT) ile
    -- gelen isteği tanıyınca `SET LOCAL ROLE service_role` uygular; bu
    -- sırada current_user = 'service_role'. Fonksiyon SECURITY INVOKER'dır
    -- (0003 varsayılanı) -> çağıran bağlamın rolünde çalışır.
    --
    -- Strict equality kullanılır; pg_has_role(...) KULLANILMAZ (postgres
    -- superuser'ı service_role üyesi sayılıp SQL Editor bypass'ına yol açar).
    -- session_user KULLANILMAZ (her zaman 'authenticator' döner).
    if current_user = 'service_role' then
        return old;
    end if;

    -- Aksi halde mevcut davranış (0003:285-302) aynen korunur. v_actor NULL
    -- ise (anon / SQL Editor / secret-key'siz bağlam) 42501; dolu ama
    -- student_id mismatch ise yine 42501. pending değilse P0003.
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

-- Trigger (appointments_delete_guard_trg, 0003:391-394) korunur; create or
-- replace function yalnızca fonksiyon gövdesini güncellediği için trigger'ı
-- yeniden oluşturmaya gerek yoktur.
