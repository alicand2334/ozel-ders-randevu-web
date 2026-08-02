-- |--------------------------------------------------------------------------
-- Migration: 0019_availability_overrides.sql
-- Açıklama:
--   Haftalık tekrar serisindeki tek bir occurrence'ı kapatmak
--   (action='cancel') ya da saatlerini değiştirmek (action='replace') için
--   istisna tablosu. Bir override yalnızca bir günü etkiler; aynı serinin
--   diğer haftalarına dokunmaz. Override kaldırılırsa o günkü pencere
--   availability satırına geri döner.
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.profiles (FK teacher_id)
--   public.availability (FK source via series_id; soft — series_id'ye
--                        doğrudan FK yerine teacher_id + series_id çifti
--                        olarak referanslanır, çünkü seriyi silsek bile
--                        override'ın kalmasını istemeyiz; cascade yerine
--                        teacher_id FK yeterli. Geniş neden: series_id
--                        tek başına PK değil, unique bir identifier olsa
--                        bile FK hedefi olabilmesi için ayrı PK gerekir;
--                        bu karmaşıklığı önlemek için doğrudan teacher FK
--                        yeterli.)
--
-- Veri modeli notları:
--   * PK: id (gen_random_uuid)
--   * Unique: (series_id, override_date) — bir seride aynı gün için tek
--     override; yeni override INSERT UPSERT mantığıyla API'de yönetilir.
--   * action='cancel': o günkü pencere yok sayılır (eğer replace için
--     start/end verirsek yeni pencere yerine cancel etkili olur — API
--     UPSERT'inde action'a göre alanlar set edilir).
--   * action='replace': start_time/end_time zorunlu, end > start.
--   * teacher_id FK'sı on delete cascade — öğretmen silinince override da
--     düşer.
--   * override_date için FK yok (zamanla seriden bağımsız olabilir),
--     doğrulama API katmanında yapılır (override_date'in seride gerçekten
--     occurrence olduğu kontrolü).
--
-- Güvenlik notları:
--   * RLS etkin. Sadece öğretmen kendi satırlarını INSERT/UPDATE/DELETE
--     edebilir; SELECT yalnızca kendi satırları. Öğrenciler bu tabloyu
--     doğrudan GÖREMEZ — efektif pencereyi availability_effective view'ından
--     (0022) okur. Bu, override içeriğini (ör. "resmi tatil" notu)
--     gizlemek için değil; veri tek kaynağını view olarak tutmak için.
--   * GRANT: authenticated'e select/insert/update/delete, RLS çerçevesinde.
--   * Migration idempotent.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- A) Tablo
-- ===========================================================================
create table if not exists public.availability_overrides (
    id uuid primary key default gen_random_uuid(),

    teacher_id uuid not null
        references public.profiles(id) on delete cascade,

    series_id uuid not null,

    override_date date not null,

    -- 'cancel'  : o günkü pencereyi tamamen kapat
    -- 'replace' : o günkü pencereyi start_time/end_time ile değiştir
    action text not null
        check (action in ('cancel', 'replace')),

    start_time time,
    end_time   time,

    note text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- action='replace' ise start_time/end_time zorunlu ve end > start.
    -- action='cancel' ise start_time/end_time NULL beklenir (zorunlu değil).
    constraint availability_overrides_replace_complete_chk
        check (
            action = 'cancel'
            or (action = 'replace'
                and start_time is not null
                and end_time is not null
                and end_time > start_time)
        )
);

-- ===========================================================================
-- B) İndeksler
-- ===========================================================================
-- Aynı seride aynı gün için tek override.
create unique index if not exists availability_overrides_series_date_uniq
    on public.availability_overrides (series_id, override_date);

-- Öğretmen kendi override'larını listelerken.
create index if not exists availability_overrides_teacher_idx
    on public.availability_overrides (teacher_id, override_date);

-- availability_effective view'ı (0022) kullanır.
create index if not exists availability_overrides_series_idx
    on public.availability_overrides (series_id, override_date);

-- ===========================================================================
-- C) RLS
-- ===========================================================================
alter table public.availability_overrides enable row level security;

revoke all on public.availability_overrides from public, anon, authenticated;
grant select on public.availability_overrides to authenticated;
grant insert on public.availability_overrides to authenticated;
grant update on public.availability_overrides to authenticated;
grant delete on public.availability_overrides to authenticated;

-- SELECT: yalnızca öğretmen kendi satırları.
drop policy if exists availability_overrides_read_policy
    on public.availability_overrides;
create policy availability_overrides_read_policy
    on public.availability_overrides
    for select
    to authenticated
    using (teacher_id = auth.uid());

-- INSERT: yalnızca aktif teacher, kendi adına.
drop policy if exists availability_overrides_insert_policy
    on public.availability_overrides;
create policy availability_overrides_insert_policy
    on public.availability_overrides
    for insert
    to authenticated
    with check (
        teacher_id = auth.uid()
        and exists (
            select 1 from public.profiles p
             where p.id = auth.uid()
               and p.role = 'teacher'
               and p.is_active = true
        )
    );

-- UPDATE: yalnızca öğretmen kendi satırı.
drop policy if exists availability_overrides_update_policy
    on public.availability_overrides;
create policy availability_overrides_update_policy
    on public.availability_overrides
    for update
    to authenticated
    using (teacher_id = auth.uid())
    with check (teacher_id = auth.uid());

-- DELETE: yalnızca öğretmen kendi satırı.
drop policy if exists availability_overrides_delete_policy
    on public.availability_overrides;
create policy availability_overrides_delete_policy
    on public.availability_overrides
    for delete
    to authenticated
    using (teacher_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Notlar:
--   * availability_overrides üzerinde ayrı updated_at trigger eklemedik;
--     API katmanı updated_at'ı SET edebilir veya gelecekte
--     set_updated_at() (0003) gibi bir trigger eklenebilir.
--   * availability_effective view (0022) bu tabloyu öğrenciye yansıtır;
--     öğrencinin doğrudan SELECT izni yok (RLS deny).
--   * teacher_students (0016) ve bildirim sistemi (0007/0008) dokunulmadı.
-- ---------------------------------------------------------------------------
