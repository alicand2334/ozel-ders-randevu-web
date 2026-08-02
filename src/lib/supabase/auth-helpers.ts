import type { AuthError } from "@supabase/supabase-js";

/** Supabase Auth hata mesajlarını Türkçe karşılıklarına çevirir. */
export function translateAuthError(error: AuthError | null): string | null {
  if (!error) return null;
  const code = error.name || error.message;
  switch (code) {
    case "AuthInvalidCredentialsError":
      return "E-posta veya şifre hatalı.";
    case "invalid_credentials":
      return "E-posta veya şifre hatalı.";
    case "AuthApiError":
      if (/already.*registered|already.*exists/i.test(error.message)) {
        return "Bu e-posta adresi zaten kayıtlı.";
      }
      if (/rate.*limit|too many/i.test(error.message)) {
        return "Çok fazla deneme yapıldı. Lütfen biraz bekleyin.";
      }
      return "Kimlik doğrulama sırasında bir hata oluştu.";
    case "AuthSessionMissingError":
      return "Oturum bulunamadı. Lütfen giriş yapın.";
    default:
      return "İşlem sırasında bir hata oluştu. Lütfen tekrar deneyin.";
  }
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function isValidPhone(phone: string): boolean {
  const v = phone.replace(/[\s\-()]/g, "");
  return /^[+]?[0-9]{7,15}$/.test(v);
}
