-- |--------------------------------------------------------------------------
-- Migration: 0011_teacher_fields.sql
-- Açıklama:
--   profiles tablosuna öğretmen zenginleştirme alanları ekler:
--     - is_active       : aktif/pasif bayrağı (varsayılan true; veri bozmaz)
--     - avatar_url      : profil fotoğrafı URL'i (Storage bucket'tan)
--     - bio             : kısa biyografi
--     - specialization  : branş (ör. "Matematik", "Fen Bilimleri")
--   Ayrıca:
--     - profiles_before_update_guard() fonksiyonunu bu yeni alanların
--       serbestçe güncellenebilmesi için uyumlu tutar (mevcut davranış
--       korunur: role immutable, updated_at otomatik).
--     - get_teacher_profiles() ve public_teacher_profiles view'ine yeni
--       alanları ekler (phone HARİC korunur, SECURITY DEFINER güvenliği
--       devam eder).
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.profiles                                 -> halihazırda oluşturuldu
--   public.profiles_before_update_guard()           -> 0003 / 0010
--   public.get_teacher_profiles() / public_teacher_profiles -> 0003
--
-- Güvenlik notları:
--   - Tüm yeni alanlar NULLABLE; default yalnızca is_active=true. Mevcut
--     satırlar etkilenmez, değerleri NULL/true olarak kalır.
--   - Yeni alanlar istemci tarafından serbestçe güncellenebilir (admin
--     RLS UPDATE politikası veya service_role API üzerinden). role yine
--     trigger ile immutable; auth.uid() not null iken role değişemez.
--   - public_teacher_profiles yalnızca teacher satırlarını döner ve
--     phone KESİNLİKLE içermez; yeni alanların oraya eklenmesi güvenlidir.
--   - is_active = false öğretmenler view'dan FILTRELENMEZ (varsayılan);
--     istemci tarafında gerekliyse where is_active = true ile filtrelenir.
--     Bunun nedeni: adminin pasif öğretmenleri de görmesi gerekir.
--   - Migration idempotent (add column if not exists, create or replace).
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- A) Yeni kolonlar
-- ===========================================================================
alter table public.profiles
    add column if not exists is_active boolean not null default true;

alter table public.profiles
    add column if not exists avatar_url text;

alter table public.profiles
    add column if not exists bio text;

alter table public.profiles
    add column if not exists specialization text;

-- ===========================================================================
-- B) profiles_before_update_guard() — alan-mutasyon denetimi
-- ===========================================================================
-- Yeni alanlar (is_active, avatar_url, bio, specialization) serbestçe
-- güncellenebilir. role immutable kuralı ve updated_at otomasyonu aynen
-- korunur. Bu yalnızca belgelendirme amaçlıdır; mevcut fonksiyon gövdesi
-- (0010_admin_role.sql) zaten role dışındaki alanlara müdahale etmez.
-- Dolayısıyla yeniden tanım GEREKMEZ; burada güncelении nessary değil.
-- ---------------------------------------------------------------------------
-- Not: Eğer ileride hangi alanların değiştirilebileceğini açık şekilde
-- kısıtlamak istersek, bu fonksiyon gövdesine `new.is_active` vs. kontrol
-- eklenebilir. Şu an geniş izinli bırakıyoruz (admin ve kullanıcı serbest).
-- ===========================================================================

-- ===========================================================================
-- C) get_teacher_profiles() + public_teacher_profiles — yeni alanlar
-- ===========================================================================
-- Fonksiyon geri dönüş tipine yeni alanlar eklenir (phone HARİÇ).
-- Studio SECURITY DEFINER + search_path = public ile güvenlik korunur.
create or replace function public.get_teacher_profiles()
returns table (
    id uuid,
    full_name text,
    role text,
    created_at timestamptz,
    is_active boolean,
    avatar_url text,
    bio text,
    specialization text
)
language sql
security definer
set search_path = public
stable
as $$
    select p.id,
           p.full_name,
           p.role,
           p.created_at,
           p.is_active,
           p.avatar_url,
           p.bio,
           p.specialization
      from public.profiles p
     where p.role = 'teacher';
$$;

revoke all on function public.get_teacher_profiles() from public;
grant execute on function public.get_teacher_profiles() to authenticated;

-- View yeniden tanımlanır (eski kolon setini bırakmak için drop+create).
-- Telefon içermeyen güvenli projeksiyon korunur.
create or replace view public.public_teacher_profiles as
    select * from public.get_teacher_profiles();

grant select on public.public_teacher_profiles to authenticated;
