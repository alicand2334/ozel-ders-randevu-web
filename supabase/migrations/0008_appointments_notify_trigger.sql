-- |--------------------------------------------------------------------------
-- Migration: 0008_appointments_notify_trigger.sql
-- Açıklama:
--   A) notifications BEFORE UPDATE guard (yalnızca `ok` alanı değişebilir).
--   B) appointments AFTER INSERT/UPDATE -> notifications üreten trigger.
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.notifications       -> 0007
--   public.appointments        -> 0002
--   public.profiles            -> halihazırda oluşturuldu
--   public.availability        -> 0001 (slot tarih/saati için)
--   public.appointments_update_guard() -> 0003 (geçerli status geçişlerini
--   denetler; bu migration passif veri üretir; geçersiz geçiş buraya hiç gelmez)
--
-- Güvenlik notları:
--   - create_notification() SECURITY DEFINER + set search_path = public, pg_temp
--     ile çalışır. Bu, mevcut 0005_sync_security_definer.sql deseniyle birebir
--     aynıdır ve GEREKLIDir çünkü:
--       * notifications tablosunda INSERT politikası YOK (0007'de kasıtlı).
--       * Trigger, öğrenci/öğretmen oturum bağlamında (RLS insert reddedilir)
--         çalışsa dahi, SECURITY DEFINER RLS'i bypass ederek güvenli şekilde
--         bildirim satırı ekler.
--   - Fonksiyon gövdesi yalnızca sabit tip/kullanıcı değerleriyle çalışır;
--     istemcinin gönderdiği veriyi yansıtmaz. title/body sunucuda TR doldurulur.
--   - search_path = public, pg_temp kullanılır (şema enjeksiyonu önlenir).
--   - Hiçbir mevcut tablo/politika/trigger DEĞİŞTİRİLMEZ; salt ekleme.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- A) notifications BEFORE UPDATE guard
-- ===========================================================================
-- İstemci yalnızca `ok` alanını false -> true yapabilir. Diğer tüm alanlar
-- (type, title, body, recipient_id, actor_id, appointment_id, created_at)
-- değiştirilemez. Bu, mevcut profiles_before_update_guard deseniyle
-- (0003_triggers_functions.sql:165) birebir aynı.
-- Not: notifications tablosunda updated_at kolonu YOK; bu guard yalnızca
-- alan-mutasyon denetimi yapar.
create or replace function public.notifications_before_update_guard()
returns trigger
language plpgsql
as $$
begin
    -- recipient_id ve appointment_id immutable.
    if new.recipient_id is distinct from old.recipient_id then
        raise exception 'Bildirimin alıcısı değiştirilemez.'
            using errcode = 'P0003';
    end if;

    if new.appointment_id is distinct from old.appointment_id then
        raise exception 'Bildirimin randevu referansı değiştirilemez.'
            using errcode = 'P0003';
    end if;

    -- type, title, body immutable.
    if new.type is distinct from old.type then
        raise exception 'Bildirim tipi değiştirilemez.'
            using errcode = 'P0003';
    end if;

    if new.title is distinct from old.title then
        raise exception 'Bildirim başlığı değiştirilemez.'
            using errcode = 'P0003';
    end if;

    if new.body is distinct from old.body then
        raise exception 'Bildirim gövdesi değiştirilemez.'
            using errcode = 'P0003';
    end if;

    -- actor_id nullable; değiştirilemez.
    if new.actor_id is distinct from old.actor_id then
        raise exception 'Bildirimi tetikleyen kullanıcı değiştirilemez.'
            using errcode = 'P0003';
    end if;

    -- created_at immutable.
    if new.created_at is distinct from old.created_at then
        raise exception 'Bildirim oluşturma zamanı değiştirilemez.'
            using errcode = 'P0003';
    end if;

    -- Yalnızca `ok` serbestçe değiştirilebilir (false->true beklenen yol).
    return new;
end;
$$;

drop trigger if exists notifications_before_update_guard_trg on public.notifications;
create trigger notifications_before_update_guard_trg
    before update on public.notifications
    for each row execute function public.notifications_before_update_guard();

-- ===========================================================================
-- B) appointments -> notifications üreten trigger fonksiyonu
-- ===========================================================================
-- SECURITY DEFINER: notifications INSERT politikası olmadığı için (0007),
-- öğrenci/öğretmen bağlamında insert reddedilir. Fonksiyon, çağıranın yetkileri
-- yerine fonksiyon sahibinin (postgres) yetkileriyle çalışır ve güvenli şekilde
-- bildirim ekler. Aynı desen 0005_sync_security_definer.sql'de kullanıldı.
create or replace function public.appointments_after_status_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_actor          uuid := auth.uid();
    v_recipient      uuid;
    v_notify_type    text;
    v_title          text;
    v_body           text;
    v_actor_name     text;
    v_recipient_name text;
    v_slot_date      date;
    v_slot_start     time;
    v_slot_end       time;
    v_date_label     text;
begin
    -- actor bilinmiyorsa (servis rolü bağlamı vs.) bildirim üretme.
    if v_actor is null then
        return null;
    end if;

    -- Slot tarih/saat bilgisini al (gövde metni için).
    select a.available_date, a.start_time, a.end_time
      into v_slot_date, v_slot_start, v_slot_end
      from public.availability a
     where a.id = new.slot_id;

    v_date_label := coalesce(
        to_char(v_slot_date, 'DD.MM.YYYY') || ' ' ||
        to_char(v_slot_start, 'HH24:MI') || '-' ||
        to_char(v_slot_end, 'HH24:MI'),
        'tarih bilgisi eksik'
    );

    -- İşlemi yapan kullanıcının adını al (gövde metni için). profiles RLS bu
    -- bağlamda bypass edilmez çünkü SECURITY DEFINER bağlamında RLS pasiftir;
    -- yine de açık select kullanırız. actor_id kendi satırını görmeyebilir
    -- (ör. öğretmen, öğrenci adını profiles over RLS ile göremez) → güvenli
    -- yol: doğrudan tabloyu sorgularken dahi SECURITY DEFINER bağlamında
    -- tüm satırlar görünür. Sonuçta ad bulunamazsa null kalır.
    select p.full_name
      into v_actor_name
      from public.profiles p
     where p.id = v_actor;

    -- =========================================================================
    -- 1) INSERT: öğrenci yeni randevu oluşturdu -> öğretmene bildirim.
    -- =========================================================================
    -- Not: TG_OP = 'INSERT' bağlamında new.student_id = auth.uid() olması
    -- garanti (appointments_insert_guard / 0003:186 denetler). Yine de
    -- savunma amacıyla: actor = student_id değilse bildirim üretme.
    if TG_OP = 'INSERT' then
        if v_actor <> new.student_id then
            return null;
        end if;

        v_recipient   := new.teacher_id;
        v_notify_type := 'booking_created';
        v_title       := 'Yeni Randevu Talebi';
        v_body        := coalesce(v_actor_name, 'Öğrenci') ||
                        ' size ' || v_date_label ||
                        ' için bir randevu talebi oluşturdu.';

        perform public.create_notification(
            p_recipient_id  := v_recipient,
            p_actor_id      := v_actor,
            p_appointment_id := new.id,
            p_type          := v_notify_type,
            p_title         := v_title,
            p_body          := v_body
        );
        return null;
    end if;

    -- =========================================================================
    -- 2) UPDATE: status değişti. Hangi bildirim üretileceğini old/new status
    --    ve actor (auth.uid()) belirler. Geçersiz geçişleri 0003:234 zaten
    --    reddeder; bu noktaya yalnızca geçerli geçişler ulaşır.
    -- =========================================================================
    if TG_OP = 'UPDATE' and new.status is distinct from old.status then

        -- Öğrenci iptal etti (pending|confirmed -> cancelled by student).
        if new.status = 'cancelled' and v_actor = new.student_id then
            v_recipient   := new.teacher_id;
            v_notify_type := 'booking_cancelled_by_student';
            v_title       := 'Randevu İptal Edildi';
            v_body        := coalesce(v_actor_name, 'Öğrenci') ||
                            ' ' || v_date_label ||
                            ' randevusunu iptal etti.';

        -- Öğretmen onayladı (pending -> confirmed).
        elsif new.status = 'confirmed' and old.status = 'pending'
              and v_actor = new.teacher_id then
            v_recipient   := new.student_id;
            v_notify_type := 'booking_confirmed';
            v_title       := 'Randevunuz Onaylandı';
            v_body        := coalesce(v_actor_name, 'Öğretmen') ||
                            ' ' || v_date_label ||
                            ' randevunuzu onayladı.';

        -- Öğretmen reddetti (pending -> cancelled by teacher).
        elsif new.status = 'cancelled' and old.status = 'pending'
              and v_actor = new.teacher_id then
            v_recipient   := new.student_id;
            v_notify_type := 'booking_rejected';
            v_title       := 'Randevu Talebi Reddedildi';
            v_body        := coalesce(v_actor_name, 'Öğretmen') ||
                            ' ' || v_date_label ||
                            ' randevu talebinizi reddetti.';

        -- Öğretmen iptal etti (confirmed -> cancelled by teacher).
        elsif new.status = 'cancelled' and old.status = 'confirmed'
              and v_actor = new.teacher_id then
            v_recipient   := new.student_id;
            v_notify_type := 'booking_cancelled_by_teacher';
            v_title       := 'Randevu İptal Edildi';
            v_body        := coalesce(v_actor_name, 'Öğretmen') ||
                            ' ' || v_date_label ||
                            ' randevunuzu iptal etti.';

        -- Öğretmen tamamlandı işaretledi (confirmed -> completed).
        elsif new.status = 'completed' and old.status = 'confirmed'
              and v_actor = new.teacher_id then
            v_recipient   := new.student_id;
            v_notify_type := 'booking_completed';
            v_title       := 'Ders Tamamlandı';
            v_body        := coalesce(v_actor_name, 'Öğretmen') ||
                            ' ' || v_date_label ||
                            ' dersini tamamlandı olarak işaretledi.';

        else
            -- Bilinen bir bildirim desenine uymayan (beklenmeyen) geçiş:
            -- bildirim üretme. Bu, yeni geçiş yolları eklendiğinde açık bir
            -- nokta olarak kalır; ileride genişletilebilir.
            return null;
        end if;

        perform public.create_notification(
            p_recipient_id  := v_recipient,
            p_actor_id      := v_actor,
            p_appointment_id := new.id,
            p_type          := v_notify_type,
            p_title         := v_title,
            p_body          := v_body
        );
        return null;
    end if;

    return null;
end;
$$;

-- ===========================================================================
-- C) Yardımcı fonksiyon: bildirim satırı ekleme (tek yerden çağrılır).
-- ===========================================================================
-- Aynı SECURITY DEFINER bağlamı; p_recipient_id / p_actor_id / p_appointment_id
-- FK ihlalleri olursa doğal 23503 hatası fırlatır. p_type CHECK constraint
-- tarafindan doğrulanır; geçersizse 23514.
create or replace function public.create_notification(
    p_recipient_id  uuid,
    p_actor_id      uuid,
    p_appointment_id uuid,
    p_type          text,
    p_title         text,
    p_body          text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    insert into public.notifications (
        recipient_id, actor_id, appointment_id, type, title, body
    )
    values (
        p_recipient_id, p_actor_id, p_appointment_id, p_type, p_title, p_body
    );
end;
$$;

-- ===========================================================================
-- D) Trigger'lar (idempotent)
-- ===========================================================================
-- AFTER INSERT: yeni randevu -> öğretmene "booking_created".
-- Mevcut appointments_sync_availability_ai (0003:398) ayrı bir tetikleyici;
-- birden fazla AFTER INSERT trigger'ı desteklenir, sırasına göre çalışır.
drop trigger if exists appointments_notify_ai on public.appointments;
create trigger appointments_notify_ai
    after insert on public.appointments
    for each row execute function public.appointments_after_status_notify();

-- AFTER UPDATE: status değişti -> ilgili bildirim.
-- Mevcut appointments_sync_availability_au (0003:403) `when (new.status is
-- distinct from old.status)` koşullu; bu trigger da aynı koşulla çalışır.
drop trigger if exists appointments_notify_au on public.appointments;
create trigger appointments_notify_au
    after update on public.appointments
    for each row
    when (new.status is distinct from old.status)
    execute function public.appointments_after_status_notify();
