/**
 * Ortak tarih/saat yardımcı fonksiyonları.
 *
 * Tek kaynak (single source of truth): Tüm UTC <-> Europe/Istanbul dönüşümleri
 * yalnızca bu dosyada yapılır. Uygulamanın geri kalanı bu fonksiyonları çağırır.
 *
 * Kurallar:
 *  - Veritabanı timestamptz sütunları (created_at, start_at, end_at, ...) UTC
 *    ISO-8601 dizisi olarak gelir. Arayüzde gösterilmeden önce Europe/Istanbul'a
 *    çevrilirler.
 *  - availability.available_date ("YYYY-MM-DD"), start_time / end_time ("HH:mm"),
 *    appointments.requested_start_time ("HH:mm") gibi metin sütunları
 *    zaten Türkiye duvar saati (wall-clock) olarak yazılmıştır. UTC dönüştürmesi
 *    gerektirmezler; yalnızca görüntüleme için biçimlendirilirler.
 *  - Arayüzde ASLA AM/PM kullanılmaz. Tüm saatler 24 saat formatındadır.
 *  - Intl.DateTimeFormat için locale her zaman "tr-TR", timeZone her zaman
 *    "Europe/Istanbul"'dur.
 */

export const TR_LOCALE = "tr-TR";
export const ISTANBUL_TZ = "Europe/Istanbul";

/** "09:00" gibi 24-saat HH:mm etiketi üretmek için kullanılan yardımcı. */
export function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/* -------------------------------------------------------------------------- */
/*  ISO (timestamptz, UTC) -> Europe/Istanbul dönüşümleri                     */
/* -------------------------------------------------------------------------- */

/**
 * Bir ISO-8601 UTC zaman damgasını (örn. "2026-08-03T06:00:00.000Z" veya
 * "2026-08-03T06:00:00+00:00") Europe/Istanbul duvar saatine göre bir Date
 * nesnesi olarak yorumla.
 *
 * Not: JS Date nesnesi içinde mutlak bir UTC anı saklar; bu fonksiyon yalnızca
 * geçersiz girişleri süzer ve geçerli giriş için aynen döner. Tüm gerçek
 * "İstanbul saatine çevirme" işi aşağıdaki format/extract fonksiyonlarında,
 * timeZone: Europe/Istanbul seçeneği ile Intl tarafından yapılır.
 */
export function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/**
 * Bir UTC ISO zaman damgasından Europe/Istanbul saat-diliminde HH:mm çekip
 * döndürür. Eski timePartOfIso fonksiyonlarının (getUTCHours kullanan) yerini
 * alır; doğru saat dilimini kullanır.
 *
 * Örnek: "2026-08-03T06:00:00.000Z" -> "09:00" (UTC+3 yaz saati uygulaması).
 */
export function timePartOfIso(iso: string | null | undefined): string | null {
  const date = parseIso(iso);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat(TR_LOCALE, {
    timeZone: ISTANBUL_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  // hour12 bazen "24" dönebilir; 24-saat düzeltmesi:
  const hhFixed = hh === "24" ? "00" : hh;
  return `${hhFixed}:${mm}`;
}

/**
 * Bir UTC ISO zaman damgasından Europe/Istanbul saat-diliminde günün dakikasını
 * (0..1439) döndürür. Eski isoToMinutes fonksiyonunun yerini alır.
 */
export function isoToMinutes(iso: string | null | undefined): number | null {
  const date = parseIso(iso);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat(TR_LOCALE, {
    timeZone: ISTANBUL_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const hhFixed = hh === 24 ? 0 : hh;
  return hhFixed * 60 + mm;
}

/* -------------------------------------------------------------------------- */
/*  Tarih-only ("YYYY-MM-DD") metin -> Europe/Istanbul yorumlaması             */
/* -------------------------------------------------------------------------- */

/**
 * Bir "YYYY-MM-DD" metnini Europe/Istanbul saat-diliminde o günün başlangıcı
 * (00:00 İstanbul) olarak yorumlayıp karşılık gelen UTC anına (Date) çevirir.
 *
 * Bu, hem takvim hesaplarında hem de gösterimde tarih-only metni için tekDoğru
 * yorumlama biçimidir. Önceden bazı dosyalar `T00:00:00Z` (UTC geceyarısı),
 * bazıları `T00:00:00` (yerel runtime geceyarısı) kullanıyordu; bu yardımcı
 * kullanıldığı sürece tek ve doğru yorumlama sağlanır.
 */
export function dateOnlyToDate(dayKey: string): Date | null {
  if (!dayKey) return null;
  // Önce "YYYY-MM-DD" formatının kabaca geçerli olduğunu doğrula.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  // Intl ile o günün İstanbul'taki geceyarı anını bul:
  // İstanbul'da 00:00, UTC+3 (yaz) veya UTC+2 (kış) olduğu için,
  // UTC'ye göre offset kadar geriye düşer. Güvenli yöntem: bir taşıyıcı
  // UTC anı oluştur, ardından Intl'in Europe/Istanbul formatıyla
  // yıl/ay/gün parçalarını çekerek geçerli olduğunu teyit et.
  let date = new Date(Date.UTC(year, month, day, 0, 0, 0));
  if (Number.isNaN(date.getTime())) return null;
  // Europe/Istanbul o günü farklı bir tarihe denk getiriyorsa (olamaz çünkü
  // zaten 00:00 UTC = gece 03:00 İstanbul aynı takvim günü) yıl/ay/gün
  // doğrulamasını Intl ile yap:
  const parts = new Intl.DateTimeFormat(TR_LOCALE, {
    timeZone: ISTANBUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y2 = Number(parts.find((p) => p.type === "year")?.value ?? NaN);
  const m2 = Number(parts.find((p) => p.type === "month")?.value ?? NaN) - 1;
  const d2 = Number(parts.find((p) => p.type === "day")?.value ?? NaN);
  if (y2 !== year || m2 !== month || d2 !== day) {
    // Offset nedeniyle 00:00 UTC o günün İstanbul'a göre 03:00'ına denk
    // gelse bile aynı gün kabul edilir; fark olması sistemik bir sorun
    // demektir. Bu durumda geriye yine de ilk hesaplanan Date'i dön.
    // (Üretimde bu dalın çalışmaması beklenir.)
    return date;
  }
  // dateOnlyToDate'nin amacı gün-ayırımı için kullanılan bir referans
  // döndürmektir; Date'in içindeki saat bölümü (UTC 00:00 -> İstanbul 03:00)
  // tarih-only karşılaştırmalarını etkilemesin diye Date'in UTC tsunamiğini
  // koruruz. Çağıranlar Intl/yardımcı fonksiyonlarla okuma yapar.
  return date;
}

/* -------------------------------------------------------------------------- */
/*  "HH:mm" wall-clock metin yardımcıları (dönüştürme yapmaz, biçimlendirir)   */
/* -------------------------------------------------------------------------- */

/**
 * Saat-dilimi dönüşümü YAPMAZ. Gelen "HH:mm[:ss]" metnini "HH:mm" olarak
 * döndürür. Bu, veritabanında zaten Türkiye duvar saati olarak saklanan
 * start_time / end_time / requested_start_time için kullanılır.
 */
export function formatTime(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 5);
}

/**
 * "HH:mm[:ss]" wall-clock metnini günün dakikasına çevirir.
 * Saat-dilimi dönüşümü yapmaz (/metin zaten Türkiye saatidir).
 */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

/**
 * Dakika (0..1439) değerinden "HH:mm" (24-saat) etiketi üretir.
 */
export function minutesToTime(totalMinutes: number): string {
  const safe = Math.max(0, Math.min(1439, Math.round(totalMinutes)));
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  return `${pad2(hh)}:${pad2(mm)}`;
}

/**
 * Bir "HH:mm" wall-clock değerine belirtilen dakikayı ekler ve "HH:mm" döndürür.
 * Gece yarısını geçmez (mod 1440 yapmaz) — mevcut davranışla uyumlu kalır.
 */
export function addMinutesToTime(value: string, addMinutes: number): string {
  const total = (timeToMinutes(value) ?? 0) + addMinutes;
  const hh = Math.floor(total / 60).toString().padStart(2, "0");
  const mm = (total % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * İki "HH:mm" wall-clock değerini "09:00–10:30" biçiminde 24-saat aralık
 * etiketi olarak birleştirir.
 */
export function formatTimeRange(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): string {
  const s = formatTime(startTime);
  const e = formatTime(endTime);
  return `${s}–${e}`;
}

/* -------------------------------------------------------------------------- */
/*  Europe/Istanbul "şu an" yardımcıları (artık yerel runtime'a bağlı değil)   */
/* -------------------------------------------------------------------------- */

/**
 * Europe/Istanbul saat-dilimine göre "bugünün" başlangıcı olan UTC anını
 * (Date) döndürür. Takvim/todayReference hesapları için kullanılır; eski
 * `Date.UTC(today.getFullYear(), ...)` yaklaşımının (yerel runtime'a bağlı)
 * yerini alır.
 */
export function istanbulTodayStart(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat(TR_LOCALE, {
    timeZone: ISTANBUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? NaN);
  const month = Number(parts.find((p) => p.type === "month")?.value ?? NaN) - 1;
  const day = Number(parts.find((p) => p.type === "day")?.value ?? NaN);
  return new Date(Date.UTC(year, month, day, 0, 0, 0));
}

/**
 * Europe/Istanbul saat-dilimine göre "bugünün" "YYYY-MM-DD" metnini döndürür.
 * Eski formatDateOnly(new Date()) yaklaşımının (yerel runtime) yerini alır.
 */
export function istanbulTodayKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat(TR_LOCALE, {
    timeZone: ISTANBUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/**
 * Europe/Istanbul saat-dilimine göre "şu an" dakikası (0..1439).
 * Eski nowMinutesOfDay() / getHours() yaklaşımının (yerel runtime) yerini alır.
 */
export function istanbulNowMinutes(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat(TR_LOCALE, {
    timeZone: ISTANBUL_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const hhFixed = hh === 24 ? 0 : hh;
  return hhFixed * 60 + mm;
}

/**
 * Verilen "YYYY-MM-DD"Europe/Istanbul tarih tuşunun bugün olup olmadığını
 * döndürür. Eski isToday() / isTodayDayKey() fonksiyonlarının yerini alır.
 */
export function isTodayKey(dayKey: string, now: Date = new Date()): boolean {
  return dayKey === istanbulTodayKey(now);
}

/* -------------------------------------------------------------------------- */
/*  Hafta (Pazartesi başlangıçlı) yardımcıları — Europe/Istanbul'a göre        */
/* -------------------------------------------------------------------------- */

/**
 * Europe/Istanbul saat-dilimine göre verilen tarihin içinde bulunduğu haftanın
 * Pazartesi gününe denk gelen UTC anını (Date) döndürür. Eski startOfWeekMonday
 * (yerel runtime yıl/ay/gün kullanırdı) yerine kullanılır.
 */
export function istanbulStartOfWeekMonday(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat(TR_LOCALE, {
    timeZone: ISTANBUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? NaN);
  const month =
    Number(parts.find((p) => p.type === "month")?.value ?? NaN) - 1;
  const day = Number(parts.find((p) => p.type === "day")?.value ?? NaN);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";

  // Intl Türkçe weekday üretir: "Pzt","Sal","Çar","Per","Cum","Cmt","Paz".
  // Eşleştirerek Pazartesi = 0 ... Pazar = 6 ofsetini hesapla.
  const weekdayIndex: Record<string, number> = {
    Pzt: 0,
    Sal: 1,
    Çar: 2,
    Per: 3,
    Cum: 4,
    Cmt: 5,
    Paz: 6,
  };
  const idx =
    weekdayIndex[weekday] ??
    (Number.isNaN(Number(weekday)) ? 0 : Number(weekday));

  // Haftanın başlangıcı (Pazartesi): o günden idx gün geri git (UTC'de).
  const mondayMidnightUtc = new Date(
    Date.UTC(year, month, day - idx, 0, 0, 0),
  );
  return mondayMidnightUtc;
}

/** Bir Date'e (UTC olarak yorumlanan) belirli gün sayısı ekler. */
export function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Bir hafta başlangıcı (Pazartesi UTC anı) listesinden 7 günün
 * "YYYY-MM-DD" tuşlarını üretir. Sonuçlar Europe/Istanbul gün tuşlarıdır
 * çünkü başlangıç zaten İstanbul gece-yarısı UTC anıdır.
 */
export function buildWeekDayKeys(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStart, i);
    return istanbulDayKeyFromDate(d);
  });
}

/**
 * Bir UTC anına (Date) karşılık gelen Europe/Istanbul "YYYY-MM-DD" gün tuşunu
 * döndürür. buildWeekDayKeys ve istanbulTodayKey ile uyumludur.
 */
export function istanbulDayKeyFromDate(date: Date): string {
  const parts = new Intl.DateTimeFormat(TR_LOCALE, {
    timeZone: ISTANBUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/**
 * Bir "YYYY-MM-DD" gün tuşunun bitiş anını (ertesi gün 00:00 İstanbul =
 * ertesi gün 00:00 UTC denk anı değil; doğru şekilde hesaplanan UTC毫秒)
 * döndürür. Takvimde "geçmiş" (past) bayrağı için kullanılır.
 *
 * Eski `new Date(\`${dayKey}T00:00:00Z\`).getTime() + 24 * 60 * 60 * 1000`
 * yaklaşımının yerini alır; bu yaklaşım İstanbul'a göre doğru çalışır çünkü
 * available_date zaten Türkiye takvim gününü temsil eder.
 */
export function istanbulDayEndMs(dayKey: string): number | null {
  const date = dateOnlyToDate(dayKey);
  if (!date) return null;
  // dayKey'in 00:00 UTC'ye karşılık gelen Date; ertesi gün 00:00 UTC = +24h
  // ( burada "gün" kelimesi İstanbul takvim günüdür ve dayKey zaten o
  //   takvim gününü ifade ettiği için jurídico olarak doğrudur. )
  return date.getTime() + 24 * 60 * 60 * 1000;
}

/* -------------------------------------------------------------------------- */
/*  Görüntüleme yardımcıları (Intl tr-TR, timeZone Europe/Istanbul)            */
/* -------------------------------------------------------------------------- */

/** Europe/Istanbul bilgisiyle Intl.DateTimeFormat oluştur. */
function istanbulFormatter(
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(TR_LOCALE, {
    ...options,
    timeZone: ISTANBUL_TZ,
  });
}

/**
 * Uzun Türkçe tarih: "3 Ağustos 2026 Pazartesi"
 * Giriş ya "YYYY-MM-DD" metni ya da ISO zaman damgası olabilir.
 */
export function formatDateLong(input: string | null | undefined): string {
  if (!input) return "";
  // "YYYY-MM-DD" (T içermez) ise dateOnly olarak yorumla; yoksa ISO zaman
  // damgasıdır ve Intl doğrudan Europe/Istanbul'a çevirir.
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input);
  const date = isDateOnly ? dateOnlyToDate(input) : parseIso(input);
  if (!date) return input;
  return istanbulFormatter({
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/**
 * Türkçe tarih: "3 Ağustos 2026" (hafta günü olmadan).
 * Giriş ya "YYYY-MM-DD" metni ya da ISO zaman damgası olabilir.
 */
export function formatDateLongNoWeekday(
  input: string | null | undefined,
): string {
  if (!input) return "";
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input);
  const date = isDateOnly ? dateOnlyToDate(input) : parseIso(input);
  if (!date) return input;
  return istanbulFormatter({
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/**
 * Türkçe hafta günü: "Pazartesi".
 * Giriş ya "YYYY-MM-DD" metni ya da ISO zaman damgası olabilir.
 */
export function formatWeekday(input: string | null | undefined): string {
  if (!input) return "";
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input);
  const date = isDateOnly ? dateOnlyToDate(input) : parseIso(input);
  if (!date) return input;
  return istanbulFormatter({ weekday: "long" }).format(date);
}

/**
 * Takvim hücresi kısa etiketi: "3.08" biçimi yerine "3.08" (gün.ay).
 * Giriş "YYYY-MM-DD" metnidir.
 */
export function formatCalendarDay(dayKey: string | null | undefined): string {
  if (!dayKey) return "";
  const date = dateOnlyToDate(dayKey);
  if (!date) return dayKey;
  return istanbulFormatter({ day: "numeric", month: "2-digit" }).format(date);
}

/**
 * Takvim haftalık aralık etiketi: "3 Ağustos – 9 Ağustos 2026".
 * Girişler UTC-anı Date'leridir (istanbulStartOfWeekMonday çıktısı gibi); her
 * ikisi de Europe/Istanbul'a göre biçimlendirilir.
 */
export function formatCalendarWeekRange(
  weekStart: Date,
  weekEnd: Date,
): string {
  const fmt = (d: Date) =>
    `${new Intl.DateTimeFormat(TR_LOCALE, {
      timeZone: ISTANBUL_TZ,
      day: "numeric",
    }).format(d)} ${new Intl.DateTimeFormat(TR_LOCALE, {
      timeZone: ISTANBUL_TZ,
      month: "long",
    }).format(d)} ${new Intl.DateTimeFormat(TR_LOCALE, {
      timeZone: ISTANBUL_TZ,
      year: "numeric",
    }).format(d)}`;
  return `${fmt(weekStart)} – ${fmt(weekEnd)}`;
}

/**
 * ISO zaman damgasını "3 Ağustos 2026 09:00" olarak biçimlendirir.
 * notification/created_at gibi timestamptz kolonları için kullanılır.
 */
export function formatDateTime(
  iso: string | null | undefined,
): string {
  const date = parseIso(iso);
  if (!date) return iso ?? "";
  return istanbulFormatter({
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * ISO zaman damgasını "3 Ağustos 09:00" olarak biçimlendirir (yıl olmadan).
 * Bildirim tarihleri için kullanılır.
 */
export function formatNotificationDate(
  iso: string | null | undefined,
): string {
  const date = parseIso(iso);
  if (!date) return iso ?? "";
  return istanbulFormatter({
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * ISO zaman damgasını "03.08.2026" biçiminde (tr-TR, gün.ay.yıl) döndürür.
 */
export function formatDateNumeric(input: string | null | undefined): string {
  if (!input) return "";
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input);
  const date = isDateOnly ? dateOnlyToDate(input) : parseIso(input);
  if (!date) return input;
  return istanbulFormatter({
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/**
 * ISO zaman damgasını "09:00" (24-saat) olarak döndürür.
 */
export function formatTimeFromIso(
  iso: string | null | undefined,
): string {
  return timePartOfIso(iso) ?? "";
}

/* -------------------------------------------------------------------------- */
/*  Süre yardımcıları (saat-dilimi bağımsız, salt aritmetik)                  */
/* -------------------------------------------------------------------------- */

/**
 * Dakika cinsinden süreyi "1 sa 30 dk" biçiminde döndürür.
 */
export function formatDuration(totalMinutes: number): string {
  if (totalMinutes <= 0) return "0 dk";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} sa`);
  if (minutes > 0) parts.push(`${minutes} dk`);
  return parts.join(" ");
}

/**
 * Dakika cinsinden süreyi "1 saat 30 dk" biçiminde döndürür.
 * formatDuration'dan farklı olarak "saat" kelimesini kullanır.
 */
export function formatDurationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) return `${hours} saat`;
  return `${hours} saat ${remaining} dk`;
}

/* -------------------------------------------------------------------------- */
/*  Kullanım özeti (refactor için referans)                                    */
/* -------------------------------------------------------------------------- */
/*
 *  ESKİ (dosya başına tekrar eden) davranış                 -> YENİ yardımcı
 *  ---------------------------------------------------------------------
 *  timePartOfIso (getUTCHours)                              -> timePartOfIso
 *  isoToMinutes (getUTCHours*60+getUTCMinutes)              -> isoToMinutes
 *  formatDate("YYYY-MM-DD") (T00:00:00, Intl runtime tz)    -> formatDateLong
 *  formatLongDate / formatDate (T00:00:00,Intl runtime tz)  -> formatDateLong /
 *                                                             formatDateLongNoWeekday
 *  formatDateTime (Tulu iso, Intl runtime tz)               -> formatDateTime
 *  formatNotificationDate (Intl runtime tz)                 -> formatNotificationDate
 *  formatWeekday ("YYYY-MM-DD")                             -> formatWeekday
 *  formatCalendarDay ("YYYY-MM-DD", T00:00:00Z manuel)      -> formatCalendarDay
 *  formatCalendarWeekRange (getUTC* + Intl ay)              -> formatCalendarWeekRange
 *  startOfWeekMonday (local y/m/d -> Date.UTC)              -> istanbulStartOfWeekMonday
 *  isTodayDayKey (local) / isToday (local)                  -> isTodayKey
 *  formatDateOnly (local) / todayStr                        -> istanbulTodayKey
 *  nowMinutesOfDay (local getHours)                         -> istanbulNowMinutes
 *  todayStartMs (local y/m/d -> Date.UTC)                  -> istanbulTodayStart
 *  slotEndOfDay (T00:00:00Z + 24h)                          -> istanbulDayEndMs
 *  timeToMinutes                                             -> timeToMinutes
 *  addMinutesToTime                                          -> addMinutesToTime
 *  minutesToTime (yoktu)                                     -> minutesToTime
 *  formatTime (slice(0,5))                                   -> formatTime
 *  formatTimeRange (yoktu)                                   -> formatTimeRange
 *  formatDuration (sa/dk)                                    -> formatDuration
 *  formatDurationLabel (saat/dk)                             -> formatDurationLabel
 *  formatTeacherDate / formatStudentDate (Intl runtime tz)  -> formatDateLongNoWeekday
 */
