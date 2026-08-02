-- |--------------------------------------------------------------------------
-- Migration: 0017_teacher_durations_settings.sql
-- Açıklama:
--   profiles tablosuna öğretmen bazlı süre ayarlarını ekler:
--     - lesson_duration_minutes  : tek ders süresi (dk). Varsayılan 40.
--     - lesson_break_minutes      : aynı öğrencinin dersleri arası mola (dk). Varsayılan 10.
--     - student_buffer_minutes   : bir öğrenci bitip diğeri başlamadan aradaki
--                                   hazırlık/bekleme süresi (dk). Varsayılan 10.
--   Bu alanlar randevu oluşturma anında appointments tablosuna snapshot
--   olarak kopyalanır (0015 lesson_duration_minutes / break zaten snapshot;
--   buffer ve blocked_until 0020'de eklenir). Öğretmen daha sonra ayarlarını
--   değiştirirse yalnızca yeni randevular etkilenir; eski randevular
--   start_at/end_at/blocked_until ile korunur.
-- ---------------------------------------------------------------------------
-- Bağımlılıklar:
--   public.profiles (0003 / 0010 / 0011 / 0013)  -> mevcut
--   public.get_teacher_profiles() / public_teacher_profiles (0003 / 0011)
--
-- Tasarım notları:
--   * NEDEN profiles'a ekleniyor (ayrı teacher_settings tablosu değil)?
--     - Ayarlar öğretmenle 1:1 ilişkili; ayrı tablo yalnızca ek JOIN/RLS
--       duplication getirir. profiles zaten teacher özelliklerini (is_active,
--       avatar_url, bio, specialization) barındırıyor (0011). RLS
--       politikaları (profiles_read_policy: id = auth.uid();
--       profiles_update_policy: id = auth.uid()) 3 yeni alanı da otomatik
--       koruma altına alır. profiles_before_update_guard (0003/0010)
--       yalnızca role immutable + updated_at otomasyonu yapar; yeni alanlar
--       serbestçe güncellenebilir — trigger'a dokunmaya gerek yok.
--     - get_teacher_profiles() (0011) SECURITY DEFINER + phone hariç güvenli
--       projeksiyon; süresi/zaman ayarları öğrenciye açık olmak zorunda
--       (randevu akışında-grid hesabı için). View'e eklemek bu güvenliği
--       bozmaz. Bu genişletme 0022'de yapılır (view yeniden tanımı).
--
-- Güvenlik notları:
--   * Tüm alanlar NOT NULL DEFAULT ile eklenir — backfill gerekmez, mevcut
--     satırlar (rol öğrenci/admin dahil) otomatik 40/10/10 alır. Öğrenci/
--     admin satırlarında bu değerler anlam taşımaz ama nullable olmadıkları
--     için etmek zorundalar; defaultlar makul. ileride rol-bağlı CHECK
--     istenirse eklenebilir (şu an sade tutuldu).
--   * CHECK kısıtları izin verilen değer aralıklarını daraltmak yerine yalnızca
--     mantıklı üst/sınırları korur; UI tarafında önerilen değerler listesi
--     (40/50/60/90, 0/5/10/15/20, 0/5/10/15/20/30) ile sınırlandırılır.
--     Noktasal enum yerine integer-aralık bırakmak, ileride farklı bir değer
--     eklemek istendiğinde migration gerektirmemesini sağlar.
--   * Migration idempotent (add column if not exists, DO $$ blokları).
--   * RLS / trigger / politika değişikliği yok. Yalnızca kolon + CHECK ekle.
--   * 0022 migration'ında get_teacher_profiles() / public_teacher_profiles
--     view'ine bu 3 alan eklenecektir; burada yapılmaz çünkü view yeniden
--     tanımı bağımlılık sırasında en son atoms should run AFTER appointments
--     altyapısı hazır. (Ayrı tutmak geri-uyumlu önem: eski view yeni alanları
--     bilmez ama yine de çalışır.)
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- A) Yeni kolonlar — NOT NULL DEFAULT ile backfill gerekmez
-- ===========================================================================
alter table public.profiles
    add column if not exists lesson_duration_minutes integer
        not null default 40;

alter table public.profiles
    add column if not exists lesson_break_minutes integer
        not null default 10;

alter table public.profiles
    add column if not exists student_buffer_minutes integer
        not null default 10;

-- ===========================================================================
-- B) CHECK kısıtları — güvenli DO $$ blokları (IF NOT EXISTS geçersizdir)
-- ===========================================================================
--  lesson_duration_minutes: pozitif, makul üst sınır (8 saat = 480 dk).
do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conname = 'profiles_lesson_duration_minutes_chk'
           and conrelid = 'public.profiles'::regclass
    ) then
        alter table public.profiles
            add constraint profiles_lesson_duration_minutes_chk
                check (lesson_duration_minutes > 0
                       and lesson_duration_minutes <= 480);
    end if;
end $$;

--  lesson_break_minutes: negatif olamaz, makul üst sınır (2 saat).
do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conname = 'profiles_lesson_break_minutes_chk'
           and conrelid = 'public.profiles'::regclass
    ) then
        alter table public.profiles
            add constraint profiles_lesson_break_minutes_chk
                check (lesson_break_minutes >= 0
                       and lesson_break_minutes <= 120);
    end if;
end $$;

--  student_buffer_minutes: negatif olamaz, makul üst sınır (2 saat).
do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conname = 'profiles_student_buffer_minutes_chk'
           and conrelid = 'public.profiles'::regclass
    ) then
        alter table public.profiles
            add constraint profiles_student_buffer_minutes_chk
                check (student_buffer_minutes >= 0
                       and student_buffer_minutes <= 120);
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- Korunan unsurlar (dokunulmadı):
--   * profiles_read_policy / profiles_update_policy (0003)
--   * profiles_before_update_guard() trigger (0003/0010)
--   * get_teacher_profiles() / public_teacher_profiles view (0011) —
--     bu migration'da yeniden tanımlanmaz; 0022'de genişletilir.
--   * appointments_insert_guard (0015) — henüz bu alanları bilmiyor; 0021'de
--     güncellenecek (öğretmen ayarlarını okuyup snapshot'a kopyalayacak).
--   * teacher_students sistemi (0016), bildirim sistemi (0007/0008).
-- ---------------------------------------------------------------------------
