-- |--------------------------------------------------------------------------
-- Migration: 0018_availability_recurrence.sql
-- Açıklama:
--   availability tablosuna haftalık tekrar serilerini temsil etmek üzere:
--     - series_id            : aynı tekrar serisine ait tüm satırları gruplar
--     - recurrence_rule      : 'WEEKLY' | NULL (tek seferlik)
--     - recurrence_end_date  : serinin bitişi (dahil), WEEKLY'de zorunlu
--     - source_date          : serinin "kaynak" tarihi (öğretmenin ilk seçtiği
--                               tarih); tekrar satırları bu günün haftanın
--                               gününe göre 7şer artarak üretilür. Tek
--                               seferlik kayıtta source_date = available_date.
--
--   Mevcut tek-günlük kayıtlar (recurrence_rule = NULL) bozulmadan korunur;
--   her existing satır kendi series_id'sini alır (1 elemanlı seri).
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.availability (0001)  -> mevcut
--
-- Veri modeli notları:
--   * Tek satır = tek bir gün için tek pencere (mevcut model korunur).
--   * Haftalık tekrar: N ayrı satır, ortak series_id. App layer (0010)
--     bu satırları tek POST isteğinde bir transaction içinde yazar. Burada
--     yalnızca tablo şeması hazırlanır; occurrence üretimi backend'de.
--   * series_id nullable olarak başlar (idempotent ADD COLUMN), backfill
--     sonrası NOT NULL'e yükseltilir. Default gen_random_uuid() sayesinde
--     mevcut satırlar otomatik unique series_id alır (1 elemanlı seri
--     anlamında).
--   * recurrence_rule 'WEEKLY' ise recurrence_end_date zorunlu ve
--     available_date'ten büyük/eşit olmalı (CHECK).
--   * source_date: NULL'da başlar, backfill'de available_date'e eşitlenir,
--     NOT NULL'a yükseltilir. Tek seferlik kayıtlarda da source_date =
--     available_date (anlamlı: "bu serinin referans günü").
--   * availability_teacher_slot_uniq (0001:38) unique indeksi
--     (teacher_id, available_date, start_time, end_time) korunur —
--     haftalık tekrarda farklı available_date'ler olduğu için çakışmaz.
--   * Yeni unique indeks: (series_id, available_date) — aynı seride aynı
--     tarih birden fazla yazılmasın (haftalık tekrar mantıksal garantisi).
--
-- Güvenlik notları:
--   * RLS / mevcut politika / trigger değişikliği yok.
--   * Migration idempotent (add column if not exists, create index if
--     not exists, DO $$ blokları).
--   * Veri kaybı yok; DROP yok.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- A) Yeni kolonlar — önce nullable/default ile ekle
-- ===========================================================================
alter table public.availability
    add column if not exists series_id uuid
        default gen_random_uuid();

alter table public.availability
    add column if not exists recurrence_rule text;

alter table public.availability
    add column if not exists recurrence_end_date date;

alter table public.availability
    add column if not exists source_date date;

-- ===========================================================================
-- B) Backfill
--   - Mevcut satırlar için series_id NULL ise yeni UUID ver (her satır kendi
--     serisi = 1 elemanlı seri).
--   - source_date NULL ise available_date yaz.
--   - recurrence_rule / recurrence_end_date NULL kalır (tek seferlik).
-- ===========================================================================
update public.availability
   set series_id = gen_random_uuid()
 where series_id is null;

update public.availability
   set source_date = available_date
 where source_date is null;

-- ===========================================================================
-- C) NOT NULL yükselt
-- ===========================================================================
alter table public.availability
    alter column series_id set not null,
    alter column source_date set not null;

-- ===========================================================================
-- D) CHECK kısıtları
-- ===========================================================================
-- recurrence_rule: NULL veya izin verilen değerlerden biri (ileride DAILY/
-- MONTHLY eklenebilir; şimdilik yalnız WEEKLY).
do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conname = 'availability_recurrence_rule_chk'
           and conrelid = 'public.availability'::regclass
    ) then
        alter table public.availability
            add constraint availability_recurrence_rule_chk
                check (recurrence_rule is null
                       or recurrence_rule in ('WEEKLY'));
    end if;
end $$;

-- WEEKLY ise recurrence_end_date zorunlu ve >= available_date.
-- Aynı zamanda source_date <= available_date (kaynak geçmişte olabilir ama
-- geen occurrence'ı kaynak tarihinde olamaz).
do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conname = 'availability_recurrence_complete_chk'
           and conrelid = 'public.availability'::regclass
    ) then
        alter table public.availability
            add constraint availability_recurrence_complete_chk
                check (
                    (recurrence_rule is null
                     and recurrence_end_date is null)
                    or (recurrence_rule = 'WEEKLY'
                        and recurrence_end_date is not null
                        and recurrence_end_date >= available_date
                        and source_date <= available_date)
                );
    end if;
end $$;

-- ===========================================================================
-- E) İndeksler
-- ===========================================================================
-- Aynı seride aynı tarih birden fazla olmasın. Harika weekly üretim
-- sırasında çift yazımı engeller (server-side transaction'da).
create unique index if not exists availability_series_date_uniq
    on public.availability (series_id, available_date);

-- Seriden silme / seri sorgu için.
create index if not exists availability_series_idx
    on public.availability (series_id, available_date);

-- ---------------------------------------------------------------------------
-- Korunan unsurlar (dokunulmadı):
--   * availability_read/insert/update/delete_policy (0001)
--   * availability_set_updated_at trigger (0003)
--   * availability_teacher_slot_uniq (0001:38)
--   * appointments_insert_guard / sync_availability_status (0015/0021)
-- ---------------------------------------------------------------------------
