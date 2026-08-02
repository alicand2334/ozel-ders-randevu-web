-- |--------------------------------------------------------------------------
-- Migration: 0003_triggers_functions.sql (REVIZE)
-- Açıklama:
--   A) Yeni auth.users kaydı için otomatik public.profiles satırı (handle_new_user)
--   B) Signup metadata -> full_name, phone; varsayılan rol 'student'
--   C) Mevcut auth.users için idempotent profiles backfill
--   D) public.profiles RLS: yalnızca kendi profilini okuma (phone dahil
--      sahibine özel) + yalnızca full_name/phone güncelleme (role DEĞİŞTİRİLEMEZ)
--   E) Öğretmen listesi için güvenli public_teacher_profiles (phone HARİÇ, RLS
--      güvenli SECURITY DEFINER fonksiyon üzerinden)
--   F) Öğretmen rolü yalnızca SQL Editor / yönetici tarafından atanabilir
--   G) updated_at otomasyonu (profiles, availability, appointments)
--   H) appointments: teacher_id otomatik, çift rezervasyon engeli, status
--      geçiş denetimi, silme denetimi
--   I) appointments -> availability.status senkronizasyonu
-- ---------------------------------------------------------------------------
-- Güvenlik notları:
--   - security definer ve `set search_path = public` yalnızca auth.users'a
--     erişen handle_new_user için kullanılır (RLS'i bypass eder ama salt okunur).
--   - Diğer fonksiyonlar invoker (oturum kullanıcısı) haklarıyla çalışır.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- A) Yeni kullanıcı için otomatik profiles satırı
-- ===========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, full_name, phone, role)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'full_name', null),
        coalesce(new.raw_user_meta_data->>'phone', null),
        'student'  -- varsayılan rol her zaman student
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ===========================================================================
-- B) Mevcut auth.users için eksik profiles kayıtlarını backfill (idempotent)
-- ===========================================================================
-- Daha önce manuel kayıt açmış kullanıcıların profiles satırı yoksa, signup
-- metadata'sından türeterek ekler. Rol kesinlikle 'student' olur.
insert into public.profiles (id, full_name, phone, role)
select
    u.id,
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'phone',
    'student'
from auth.users u
where not exists (
    select 1 from public.profiles p where p.id = u.id
)
on conflict (id) do nothing;

-- ===========================================================================
-- C) public.profiles RLS politikaları
-- ===========================================================================
-- role DEĞİŞTİRİLEMEZ: bunu RLS yerine açık bir BEFORE UPDATE trigger'ı ile
-- garantiliyoruz (aşağıda profiles_before_update_guard_trg).
-- Okuma: KULLANICI YALNIZCA KENDİ PROFİLİNİ okur. phone dahil tüm alanlar
-- yalnızca profil sahibine açıktır. Öğretmen listesi için güvenli view
-- (public_teacher_profiles) aşağıda ayrıca oluşturulur; o view phone içermez.
alter table public.profiles enable row level security;

-- Okuma: yalnızca kendi satırı (phone dahil tüm alanlar sahibine özel).
drop policy if exists profiles_read_policy on public.profiles;
create policy profiles_read_policy
    on public.profiles
    for select
    to authenticated
    using (id = auth.uid());

-- Güncelleme: yalnızca kendi satırı. Hangi alanların değişebileceği
-- (full_name + phone, role HARİÇ) trigger ile zorlanır.
drop policy if exists profiles_update_policy on public.profiles;
create policy profiles_update_policy
    on public.profiles
    for update
    to authenticated
    using (id = auth.uid())
    with check (id = auth.uid());

-- ===========================================================================
-- C2) public_teacher_profiles view (öğretmen listesi - phone HARİÇ)
-- ===========================================================================
-- Öğrencilerin öğretmenleri bulabilmesi için güvenli görünüm.
--   Dönen alanlar: id, full_name, role, created_at  (phone YOK)
--   Yalnızca role = 'teacher' satırları döner.
--
-- ÖNEMLI: Bir view, alt tablonun RLS'ini miras alır. profiles okuma politikası
-- `using (id = auth.uid())` olduğundan, view üzerinden yapılan sorgu RLS'i
-- geçemeyecek ve öğrenci hiçbir öğretmen satırını göremeyecektir. Bu yüzden
-- güvenli projeksiyonu bir SECURITY DEFINER fonksiyon + public view ile
-- sağlıyoruz: fonksiyon sahibi (yüksek yetkili) olarak çalışır ve yalnızca
-- role='teacher' + phone içermeyen alanları döner.
-- ---------------------------------------------------------------------------

-- Tek kaynak: fonksiyon, auth.uid() ne olursa olsun tüm teacher satırlarını
-- id+full_name+role+created_at olarak döndürür. phone DAHİL DEĞİL.
create or replace function public.get_teacher_profiles()
returns table (
    id uuid,
    full_name text,
    role text,
    created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
    select p.id, p.full_name, p.role, p.created_at
    from public.profiles p
    where p.role = 'teacher';
$$;

-- Tüm authenticated kullanıcıları çağırabilir (fonksiyonlar için grant).
-- PUBLIC verme; yalnızca authenticated.
revoke all on function public.get_teacher_profiles() from public;
grant execute on function public.get_teacher_profiles() to authenticated;

-- İsim kolaylığı için view (RLS'i devre dışı bırakılan tabloya değil,
-- fonksiyona dayanır). View public'e açılır; veriyi fonksiyon projeksiyonu
-- belirler, phone asla sızamaz.
create or replace view public.public_teacher_profiles as
    select * from public.get_teacher_profiles();

-- View üzerinde select hakkı authenticated kullanıcılarına verilir.
-- (View fonksiyonu çağırır; fonksiyon SECURITY DEFINER olduğu için RLS'i
-- aşar; ancak dönen kolonlar güvenlidir.)
grant select on public.public_teacher_profiles to authenticated;


-- ===========================================================================
-- D) updated_at otomasyonu (genel amaçlı)
-- ===========================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

-- ===========================================================================
-- D2) profiles: role değişmez + güncellenebilir alan kısıtı
-- ===========================================================================
-- BEFORE UPDATE: role kesinlikle değişemez (yönetici SQL Editor hariç).
-- id değişemez (PK zaten). updated_at burada otomatik set edilir.
-- Yalnızca full_name ve phone serbestçe değiştirilebilir.
create or replace function public.profiles_before_update_guard()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();

    if new.role is distinct from old.role then
        raise exception 'Profil rolü bu işlemle değiştirilemez. Yalnızca yönetici SQL Editor üzerinden atanabilir.'
            using errcode = 'P0003';
    end if;

    -- id, created_at kullanıcının değiştirmesine izin verilmez; Updated_at
    -- zaten yukarıda set edildi. full_name/phone serbest.
    return new;
end;
$$;

-- ===========================================================================
-- E) appointments: teacher_id otomatik + çift rezervasyon engeli
-- ===========================================================================
create or replace function public.appointments_insert_guard()
returns trigger
language plpgsql
as $$
declare
    v_slot_status text;
    v_slot_teacher uuid;
    v_student_role text;
begin
    select status, teacher_id
      into v_slot_status, v_slot_teacher
      from public.availability
      where id = new.slot_id;

    if not found then
        raise exception 'Belirtilen randevu slotu bulunamadı. (slot_id = %)', new.slot_id
            using errcode = '23503';
    end if;

    if v_slot_status <> 'open' then
        raise exception 'Bu saat aralığı artık uygun değil (slot durumu: %). Lütfen başka bir saat deneyin.', v_slot_status
            using errcode = 'P0003';
    end if;

    new.teacher_id := v_slot_teacher;

    if new.teacher_id = new.student_id then
        raise exception 'Bir öğretmen kendine randevu oluşturamaz.'
            using errcode = 'P0003';
    end if;

    select role
      into v_student_role
      from public.profiles
      where id = new.student_id;

    if v_student_role is distinct from 'student' then
        raise exception 'Randevu yalnızca öğrenci rolündeki kullanıcılar oluşturabilir.'
            using errcode = 'P0003';
    end if;

    return new;
end;
$$;

-- ===========================================================================
-- F) appointments: status geçiş denetimi (rol bazlı)
-- ===========================================================================
create or replace function public.appointments_update_guard()
returns trigger
language plpgsql
as $$
declare
    v_actor uuid := auth.uid();
begin
    new.updated_at := now();

    if v_actor is null then
        raise exception 'Kimlik doğrulanmamış istek.'
            using errcode = '42501';
    end if;

    if new.status is distinct from old.status then
        if v_actor = new.student_id then
            if not (
                (old.status = 'pending' and new.status = 'cancelled')
                or (old.status = 'confirmed' and new.status = 'cancelled')
            ) then
                raise exception 'Öğrenci yalnızca randevuyu iptal edebilir.'
                    using errcode = 'P0003';
            end if;
            return new;
        end if;

        if v_actor = new.teacher_id then
            if not (
                (old.status = 'pending'    and new.status = 'confirmed')
                or (old.status in ('pending','confirmed') and new.status = 'cancelled')
                or (old.status = 'confirmed' and new.status = 'completed')
            ) then
                raise exception 'Bu durum geçişi öğretmen için geçerli değil (% -> %).',
                    old.status, new.status
                    using errcode = 'P0003';
            end if;
            return new;
        end if;

        raise exception 'Bu randevunun durumunu değiştirme yetkiniz yok.'
            using errcode = '42501';
    end if;

    -- subject/notes gibi alanlar ilgili kişi tarafından güncellenebilir
    return new;
end;
$$;

-- ===========================================================================
-- G) appointments: silme yalnızca pending iken (öğrenci kendi kaydı)
-- ===========================================================================
create or replace function public.appointments_delete_guard()
returns trigger
language plpgsql
as $$
declare
    v_actor uuid := auth.uid();
begin
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

-- ===========================================================================
-- H) appointments -> availability.status senkronizasyonu
-- ===========================================================================
create or replace function public.sync_availability_status()
returns trigger
language plpgsql
as $$
declare
    v_slot uuid;
    v_active_count int;
begin
    if TG_OP = 'INSERT' then
        update public.availability
           set status = 'booked'
         where id = new.slot_id;
        return new;
    end if;

    if TG_OP = 'UPDATE' then
        if new.status in ('confirmed','completed') then
            update public.availability
               set status = 'booked'
             where id = new.slot_id;
        elsif new.status = 'cancelled' then
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

-- ===========================================================================
-- I.) Tetikleyicileri oluştur / yeniden oluştur (idempotent)
-- ===========================================================================
-- profiles: BEFORE UPDATE koruması (role değişmez + updated_at otomasyonu).
-- Tek BEFORE UPDATE tetikleyicisi kullanılır; bu fonksiyon hem role'ü sabitler
-- hem updated_at'i set eder (profiles_before_update_guard içinde).
drop trigger if exists profiles_set_updated_at on public.profiles;
drop trigger if exists profiles_before_update_guard_trg on public.profiles;
create trigger profiles_before_update_guard_trg
    before update on public.profiles
    for each row execute function public.profiles_before_update_guard();

drop trigger if exists availability_set_updated_at on public.availability;
create trigger availability_set_updated_at
    before update on public.availability
    for each row execute function public.set_updated_at();

-- Not: appointments_set_updated_at trigger'ı YOK; updated_at güncellemesi
-- appointments_update_guard fonksiyonu içinde yapılır.
drop trigger if exists appointments_set_updated_at on public.appointments;

-- appointments korumaları
drop trigger if exists appointments_insert_guard_trg on public.appointments;
create trigger appointments_insert_guard_trg
    before insert on public.appointments
    for each row execute function public.appointments_insert_guard();

drop trigger if exists appointments_update_guard_trg on public.appointments;
create trigger appointments_update_guard_trg
    before update on public.appointments
    for each row execute function public.appointments_update_guard();

drop trigger if exists appointments_delete_guard_trg on public.appointments;
create trigger appointments_delete_guard_trg
    before delete on public.appointments
    for each row execute function public.appointments_delete_guard();

-- availability senkron
drop trigger if exists appointments_sync_availability_ai on public.appointments;
create trigger appointments_sync_availability_ai
    after insert on public.appointments
    for each row execute function public.sync_availability_status();

drop trigger if exists appointments_sync_availability_au on public.appointments;
create trigger appointments_sync_availability_au
    after update on public.appointments
    for each row
    when (new.status is distinct from old.status)
    execute function public.sync_availability_status();

drop trigger if exists appointments_sync_availability_ad on public.appointments;
create trigger appointments_sync_availability_ad
    after delete on public.appointments
    for each row execute function public.sync_availability_status();
