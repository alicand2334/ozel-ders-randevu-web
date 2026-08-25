-- |--------------------------------------------------------------------------
-- Migration: 0024_service_role_delete_grants.sql
-- Açıklama:
--   service_role rolüne, öğretmen kalıcı silme akışında cascade ile
--   temizlenmesi gereken child tablolarda DELETE yetkisi verir.
--
--   Sorun:
--     Admin panelinden bir öğretmen kalıcı olarak silinirken sırasıyla
--     önce bağlı child kayıtların (appointments, availability,
--     availability_overrides, teacher_students, notifications) service-role
--     client ile .delete() ile temizlenmesi, ardından public.profiles satırının
--     silinmesi ve son olarak auth.admin.deleteUser(teacherId) çağrılması
--     hedefleniyor (src/app/api/admin/teachers/[id]/route.ts DELETE handler).
--
--     Ancak bu tabloların hiçbirinde service_role için tablo seviyesinde
--     DELETE yetkisi tanımlanmamış (yalnızca 0014 migration'ında
--     public.profiles'a verilmişti). Bu nedenle service-role client ile
--     yapılan `admin.from("<tab>").delete().eq(...)` çağrıları
--     PostgreSQL 42501 "permission denied for table <tab>" hatası veriyor
--     (PostgREST tarafından HTTP 403 ve `{"code":"42501", ...}` olarak
--     yüzeye çıkıyor).
--     Child kayıtlar temizlenemeyince:
--       1) public.profiles satırı silinemiyor (calendar cascade
--          tetiklenmedigi için; aslında cascade FK'lar olsa da
--          service_role profiles delete yetkisi var, ama child tablolar
--          grant eksikliği ayrıca akışı durduruyor).
--       2) auth.admin.deleteUser(teacherId) GoTrue admin endpoint'inde
--          `{"code":500,"error_code":"unexpected_failure","msg":"Database error deleting user"}`
--          veriyor; supabase-js bunu AuthRetryableFetchError, status 500
--          olarak sarmalıyor.
--
--   Çözüm:
--     service_role rolüne aşağıdaki tablolarda DELETE yetkisi verilir:
--       - public.appointments
--       - public.availability
--       - public.availability_overrides
--       - public.teacher_students
--       - public.notifications
--     RLS bypass ayrıcalığı service_role'de hâlihazırda mevcuttur; eksik
--     olan yalnızca tablo seviyesinde GRANT. SELECT yetkisi hâlihazırda
--     çalıştığı için (PostgREST tablo sahibi implicit izni veya
--     authenticated/anon GRANT'ları üzerinden) yalnızca DELETE eklenir;
--     SELECT/INSERT/UPDATE bu migration kapsamında dokunulmaz.
--
--   Önemli not:
--     Migration idempotenttir (GRANT tekrar çalıştırılabilir). Hiçbir RLS
--     politikası, FOREIGN KEY, ON DELETE davranışı, trigger veya mevcut
--     profil yetkileri değiştirilmez. anon ve authenticated rollerinin
--     yetkileri değiştirilmez. Hiçbir veri silinmez.
-- ---------------------------------------------------------------------------

-- Appointments: öğretmen/student randevuları. profiles silinince ON DELETE
-- CASCADE ile otomatik düşer; ancak admin akışı bunları önceden elle siler.
grant delete on public.appointments to service_role;

-- Availability: öğretmen müsaitlik satırları. profiles silinince CASCADE
-- düşer; admin akışı sırasında manuel temizlenir.
grant delete on public.availability to service_role;

-- Availability overrides: öğretmen hareketli müsaitlik override satırları.
-- profiles silinince CASCADE düşer.
grant delete on public.availability_overrides to service_role;

-- Teacher-student ilişkileri. profiles silinince CASCADE düşer.
grant delete on public.teacher_students to service_role;

-- Notifications: alıcı kayıtları. profiles silinince ON DELETE CASCADE
-- (recipient) ve SET NULL (actor); admin akışı bu tabloya doğrudan erişemediği
-- için service_role SELECT yetkisi olması da gerekir, fakat bu migration
-- yalnızca DELETE ile sınırlıdır. SELECT yetkisi ayrıca ek bir migrationda
-- ele alınacaktır; bu dosya silme akışını açmak içindir.
grant delete on public.notifications to service_role;
