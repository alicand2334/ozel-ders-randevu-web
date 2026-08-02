-- |--------------------------------------------------------------------------
-- Migration: 0012_first_admin_bootstrap.sql
-- Açıklama:
--   profiles_before_update_guard() fonksiyonunu güvenli "ilk admin bootstrap"
--   modelini destekleyecek şekilde yeniden tanımlar.
--
--   Sorun:
--     0010_admin_role.sql service_role (auth.uid() IS NULL) bağlamında role
--     değişikliğine izin verecek şekilde fonksiyonu tanımladı. Ancak Supabase
--     SQL Editor bazı sürümlerde auth.uid() NULL döndürmeyebilir (Studio
--     oturum claim'leri sebebiyle), bu da ilk admin atamasını engelleyebilir.
--
--   Çözüm:
--     Role değişikliği yalnızca aşağıdaki güvenli koşullardan birinde kabul edilir:
--       1) service_role bağlamı: auth.uid() IS NULL  (0010 mevcut davranış)
--       2) İlk-admin bootstrap bağlamı: hedef rol 'admin' VE veritabanında
--          hiç admin yok (count(*) = 0).
--     Aksi her durumda role değişikliği reddedilir. Bu, "ilk admin atanana kadar
--     yalnızca bir kez admin atamasına izin" garantisi verir; ilk admin
--     oluştuktan sonra tüm role değişimleri yalnızca service_role (server-side
--     API / SQL Editor) üzerinden yapılabilir.
--
-- Güvenlik notları:
--   - Trigger (profiles_before_update_guard_trg) bırakılır; yalnızca fonksiyon
--     gövdesi create or replace ile güncellenir. RLSpolitika'larına dokunulmaz.
--   - Normal authenticated kullanıcı (auth.uid() dolu): role değiştiremez.
--     İlk admin yokken dahi "student -> teacher" gibi değişimler reddedilir.
--   - Bootstrap sonrası: "student -> admin" denemeleri reddedilir (admin var).
--   - updated_at otomasyonu ve diğer alanların serbest bırakılması korunur.
--   - Migration idempotent (create or replace).
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.profiles                           -> halihazırda oluşturuldu
--   public.profiles_before_update_guard()     -> 0003 / 0010
--   profiles_before_update_guard_trg          -> 0003 (silinmez, korunur)
-- ---------------------------------------------------------------------------

create or replace function public.profiles_before_update_guard()
returns trigger
language plpgsql
as $$
declare
    v_admin_count int;
begin
    new.updated_at := now();

    -- ===================================================================
    -- Role değişikliği denetimi
    -- ===================================================================
    if new.role is distinct from old.role then
        -- 1) service_role / SQL Editor bağlamı: auth.uid() NULL -> izin ver.
        --    Bu, server-side API'nin (Adım 6) role atama yolu olarak güvenli.
        if auth.uid() is null then
            -- Yeni değer CHECK constraint tarafından doğrulanır.
            null;
        -- 2) İlk-admin bootstrap: hedef rol 'admin' ve hiç admin yok -> izin.
        --    Bu tek pencere, ilk admin atanır atanmaz kapanır.
        elsif new.role = 'admin' then
            select count(*) into v_admin_count
              from public.profiles
             where role = 'admin';

            if v_admin_count > 0 then
                raise exception 'Sistemde zaten bir yönetici var. Yeni yönetici ataması yalnızca yönetici API''si (service_role) üzerinden yapılabilir.'
                    using errcode = 'P0003';
            end if;
            -- v_admin_count = 0 -> ilk admin atamasına izin ver.
        else
            -- 3) auth.uid() dolu VE hedef rol admin değil -> reddet.
            --    Normal kullanıcı hiçbir role değişikliği yapamaz.
            raise exception 'Profil rolü bu işlemle değiştirilemez. Yalnızca yönetici (server-side API / SQL Editor) üzerinden atanabilir.'
                using errcode = 'P0003';
        end if;
    end if;

    -- id, created_at kullanıcı tarafından değiştirilemez.
    -- full_name / phone / is_active / avatar_url / bio / specialization serbest.
    return new;
end;
$$;

-- Trigger (0003:367) korunur; create or replace yeterli, drop/recreate gerekmez.
