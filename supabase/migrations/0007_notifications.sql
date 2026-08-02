-- |--------------------------------------------------------------------------
-- Migration: 0007_notifications.sql
-- Açıklama: Kullanıcılar arası randevu bildirimlerini tutan tablo + RLS.
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.profiles      (id uuid, role text)               -> halihazırda oluşturuldu
--   public.appointments  (id uuid, student_id, teacher_id)  -> 0002
--
-- Veri modeli notları:
--   - Bildirim SATIRI yalnızca sunucu-taraflı trigger tarafından oluşturulur.
--     İstemci (öğrenci/öğretmen) notifications tablosuna INSERT yapamaz;
--     RLS INSERT politikası bilinçli olarak TANIMLANMAZ. Bu, spam / enjeksiyon
--     saldırısını kökten engeller. Trigger fonksiyonu SECURITY DEFINER olarak
--     çalıştığı için RLS'i bypass eder (0008'de tanımlanır).
--   - recipient_id : bildirimin ALICISI (öğrenci veya öğretmen).
--   - actor_id     : işlemi YAPAN karşı taraf (sadece denetim/FFK tutarlılığı
--     için; istemciye gösterilmesine gerek yoktur — gövde metni zaten
--     sunucuda doldurulur).
--   - appointment_id: bildirimin konusu olan randevu (on delete cascade).
--   - type: enum-tarzı CHECK; 6 olası değer (planlanan 5 bildirimin yanı sıra
--     "öğrenci iptal" ve "öğretmen iptal" ayrı type olarak tutulur).
--   - ok: okundu/bakıldı bayrağı; default false. İstemci yalnızca bu alanı
--     true yapabilir (UPDATE policy + BEFORE UPDATE trigger guard ile
--     zorlanır; 0008'de tanımlanır).
--   - Silme politikası YOK: bildirimler hiçbir zaman silinemez. Denetim izi
--     korunur; "okundu" olarak işaretlenir.
-- ---------------------------------------------------------------------------
-- Güvenlik notları:
--   - RLS zorunlu. select/update yalnızca recipient = auth.uid() iken geçerli.
--   - INSERT / DELETE politikası YOK (reddedilir).
--   - Mevcut hiçbir tablo/trigger/politika değiştirilmez; salt ekleme.
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),

    -- Bildirimin alıcısı. Kullanıcı silindiğinde bildirim de silinir.
    recipient_id uuid not null
        references public.profiles(id) on delete cascade,

    -- İşlemi yapan karşı taraf. Kullanıcı silinince null'a düşer; FK tutarlılığı
    -- korunur ama bildirim metni (title/body) zaten doldurulduğu için referans
    -- kaybı görüntüyü bozmaz.
    actor_id uuid
        references public.profiles(id) on delete set null,

    -- Bildirimin konusu olan randevu. Randevu silinince bildirim de silinir.
    appointment_id uuid not null
        references public.appointments(id) on delete cascade,

    -- Bildirim tipi. Mevcut 6 durum (planlanan 5 bildirim; "öğretmen iptal"
    -- ve "öğrenci iptal" ayrı tutulur).
    type text not null check (type in (
        'booking_created',
        'booking_confirmed',
        'booking_rejected',
        'booking_cancelled_by_student',
        'booking_cancelled_by_teacher',
        'booking_completed'
    )),

    -- Sunucu-taraflı doldurulmuş gösterilecek başlık (TR).
    title text,
    -- Sunucu-taraflı doldurulmuş gösterilecek gövde (TR).
    body text,

    -- Okundu/bakıldı bayrağı. İstemci yalnızca bunu true yapabilir.
    ok boolean not null default false,

    created_at timestamptz not null default now()
);

-- ===========================================================================
-- Indeksler
-- ===========================================================================
-- Alıcının en son bildirimlerini listelemek için.
create index if not exists notifications_recipient_created_idx
    on public.notifications (recipient_id, created_at desc);

-- Okunmamış bildirim sayısını çabuk çekmek için kısmi indeks.
create index if not exists notifications_recipient_unread_idx
    on public.notifications (recipient_id)
    where ok = false;

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.notifications enable row level security;

-- Okuma: yalnızca alıcı kendi satırlarını görür. actor_id'yi DOĞRUDAN select
-- listesine almaya gerek yoktur (gövde metni zaten doldurulmuştur); ancak
--Recipient RLS'i actor_id'yi görmesini bagımsız olarak engeller (using =
--recipient_id = auth.uid()).
drop policy if exists notifications_read_policy on public.notifications;
create policy notifications_read_policy
    on public.notifications
    for select
    to authenticated
    using (recipient_id = auth.uid());

-- Güncelleme: yalnızca alıcı kendi satırını güncelleyebilir. Hangi alanların
-- değişebileceği (yalnızca `ok` ve updated_at) BEFORE UPDATE trigger guard
-- ile zorlanır (0008'de tanımlanır). Burada satır-düzeyinde erişim verilir.
drop policy if exists notifications_update_policy on public.notifications;
create policy notifications_update_policy
    on public.notifications
    for update
    to authenticated
    using (recipient_id = auth.uid())
    with check (recipient_id = auth.uid());

-- ===========================================================================
-- Kasıtlı olarak TANIMLANMAYAN politikalar:
--   - INSERT politikası YOK  -> istemci (authenticated) insert edemez.
--     Bildirim yalnızca SECURITY DEFINER trigger fonksiyonu tarafından üretilir.
--   - DELETE politikası YOK  -> bildirimler hiçbir zaman silinemez; denetim
--     izi korunur, "okundu" olarak işaretlenir.
-- ---------------------------------------------------------------------------
-- Bu davranış 0004_rls_tests.sql tarzı bir sonraki test migration'ında
-- doğrulanabilir (bu migration'da test YOK; yalnızca şema + RLS).
-- ===========================================================================
