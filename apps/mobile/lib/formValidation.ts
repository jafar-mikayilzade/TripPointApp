/** Ad / şəhər / başlıq: rəqəmləri silir (yazarkən). */
export function sanitizeFullNameInput(value: string): string {
  return value.replace(/[0-9۰-۹٠-٩]/g, '');
}

/** Yalnız hərf (və boşluq, tire, apostrof) — rəqəm qadağandır. */
export function sanitizeLettersOnlyInput(value: string): string {
  return sanitizeFullNameInput(value);
}

export function validateLettersOnlyField(
  value: string,
  fieldLabel: string,
  options?: { required?: boolean; minLength?: number }
): string | null {
  const required = options?.required ?? true;
  const minLength = options?.minLength ?? 2;
  const trimmed = value.trim();

  if (!trimmed) {
    if (!required) {
      return null;
    }
    return `${fieldLabel} boş ola bilməz. Yalnız hərflərlə yazın.`;
  }

  if (/[0-9۰-۹٠-٩]/.test(value)) {
    return `${fieldLabel} xanasına rəqəm yazmaq olmaz. Yalnız hərflərdən istifadə edin.`;
  }

  if (trimmed.length < minLength) {
    return `${fieldLabel} ən azı ${minLength} hərf olmalıdır.`;
  }

  if (!/^[\p{L}\s'.-]+$/u.test(trimmed)) {
    return `${fieldLabel} yalnız hərflərdən ibarət olmalıdır. Rəqəm qəbul olunmur.`;
  }

  return null;
}

export function validateFullName(name: string): string | null {
  return validateLettersOnlyField(name, 'Ad soyad', { minLength: 2 });
}

export type PasswordRuleId = 'minLength' | 'upper' | 'lower' | 'digit';

export const PASSWORD_RULES: {
  id: PasswordRuleId;
  label: string;
  test: (password: string) => boolean;
}[] = [
  {
    id: 'minLength',
    label: 'Ən azı 8 simvol',
    test: (password) => password.length >= 8,
  },
  {
    id: 'upper',
    label: 'Ən azı bir böyük hərf',
    test: (password) => /\p{Lu}/u.test(password),
  },
  {
    id: 'lower',
    label: 'Ən azı bir kiçik hərf',
    test: (password) => /\p{Ll}/u.test(password),
  },
  {
    id: 'digit',
    label: 'Ən azı bir rəqəm',
    test: (password) => /\d/.test(password),
  },
];

export function getPasswordRuleStatus(password: string) {
  return PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    met: rule.test(password),
  }));
}

export function validatePassword(password: string): string | null {
  if (!password) {
    return 'Şifrə xanası boş ola bilməz. Bütün tələbləri ödəyin.';
  }

  const unmet = PASSWORD_RULES.filter((rule) => !rule.test(password));
  if (unmet.length > 0) {
    return `Şifrə tələbləri ödənilməyib: ${unmet.map((r) => r.label).join(', ')}.`;
  }

  return null;
}

/** Carpool avtomatik başlıq: şəkilçi olmadan, bütün şəhərlər üçün eyni. */
export function buildCarpoolTitle(origin: string, destination: string): string {
  const from = origin.trim();
  const to = destination.trim();
  if (!from || !to) {
    return '';
  }
  return `${from} ${to} istiqamətində gedirəm`;
}

/**
 * Email: ad@domen.zona formatı.
 * Səhv yeri aydın Azərbaycan dilində izah olunur.
 */
export function validateEmail(email: string): string | null {
  const trimmed = email.trim();

  if (!trimmed) {
    return 'E-poçt xanası boş ola bilməz. Məsələn: ad@gmail.com';
  }

  if (/\s/.test(trimmed)) {
    return 'E-poçtda boşluq ola bilməz. Boşluqları silin.';
  }

  if (!trimmed.includes('@')) {
    return 'E-poçtda @ işarəsi yoxdur. Düzgün format: ad@domen.com';
  }

  const atCount = (trimmed.match(/@/g) ?? []).length;
  if (atCount > 1) {
    return 'E-poçtda yalnız bir @ işarəsi olmalıdır. Artıq @-ları silin.';
  }

  const [localPart, domainPart] = trimmed.split('@');

  if (!localPart) {
    return '@-dan əvvəl ad hissəsi yazılmalıdır. Məsələn: ad@gmail.com (@-dan əvvəl "ad").';
  }

  if (!domainPart) {
    return '@-dan sonra domen yazılmalıdır. Məsələn: ad@gmail.com (@-dan sonra "gmail.com").';
  }

  if (domainPart.startsWith('.') || domainPart.endsWith('.')) {
    return 'Domen hissəsi nöqtə ilə başlaya və ya bitə bilməz. Məsələn: gmail.com';
  }

  if (!domainPart.includes('.')) {
    return 'Domen-də nöqtə (.) və zona yoxdur. Format: ad@domen.com — məsələn ad@gmail.com';
  }

  const domainLabels = domainPart.split('.');
  if (domainLabels.some((part) => part.length === 0)) {
    return 'Domen-də ardıcıl nöqtə ola bilməz. Məsələn: gmail.com düzgün, gmail..com səhvdir.';
  }

  const tld = domainLabels[domainLabels.length - 1];
  if (!tld || tld.length < 2) {
    return 'E-poçtun sonunda zona (məs: com, ru, az) ən azı 2 hərf olmalıdır. Məsələn: ad@mail.az';
  }

  if (!/^[a-zA-Z0-9._%+-]+$/.test(localPart)) {
    return 'E-poçtun @-dan əvvəlki hissəsində yolverilməz simvol var. Yalnız hərf, rəqəm və . _ % + - istifadə edin.';
  }

  if (!/^[a-zA-Z0-9.-]+$/.test(domainPart)) {
    return 'Domen hissəsində yolverilməz simvol var. Məsələn düzgün forma: gmail.com';
  }

  if (!/^[a-zA-Z]{2,}$/.test(tld)) {
    return 'E-poçtun sonundakı zona yalnız hərflərdən ibarət olmalıdır (məs: com, az).';
  }

  const fullOk = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed);

  if (!fullOk) {
    return 'E-poçt formatı yanlışdır. Düzgün nümunə: adsoyad@gmail.com';
  }

  return null;
}

/** Azərbaycan mobil: +994 + 9 rəqəm. */
export const AZ_PHONE_PREFIX = '+994';
/** Yazarkən 0 daxil olmaqla max: 0501234567 */
export const AZ_PHONE_MAX_WITH_LEADING_ZERO = 10;
/** Normallaşdırılmış yerli uzunluq: 501234567 */
export const AZ_PHONE_LOCAL_LENGTH = 9;

/**
 * Yazarkən: yalnız rəqəm, 994 silinir, başdakı 0 saxlanılır (max 10).
 */
export function sanitizeAzPhoneLocalInput(raw: string): string {
  let digits = raw.replace(/\D/g, '');

  if (digits.startsWith('994')) {
    digits = digits.slice(3);
  }

  return digits.slice(0, AZ_PHONE_MAX_WITH_LEADING_ZERO);
}

/**
 * Blur / DB: başdakı 0 silinir, 9 rəqəmə qədər kəsilir (0501234567 → 501234567).
 */
export function normalizeAzPhoneLocal(raw: string): string {
  let digits = sanitizeAzPhoneLocalInput(raw);

  while (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  return digits.slice(0, AZ_PHONE_LOCAL_LENGTH);
}

/** DB / UI üçün tam format: +994501234567 və ya boş. */
export function formatAzPhoneE164(localDigits: string): string {
  const local = normalizeAzPhoneLocal(localDigits);
  return local ? `${AZ_PHONE_PREFIX}${local}` : '';
}

/** Mövcud DB dəyərindən yerli 9 rəqəmi çıxarır. */
export function parseAzPhoneLocal(stored: string | null | undefined): string {
  if (!stored) {
    return '';
  }
  return normalizeAzPhoneLocal(stored);
}

/**
 * @param localOrFull — ya yerli rəqəmlər, ya +994...
 * @param required — məcburi sahədirsə boş qəbul olunmur
 */
export function validateAzPhone(
  localOrFull: string,
  required = false
): string | null {
  if (/[a-zA-ZəöğçşıüƏÖĞÇŞIİÜ]/.test(localOrFull)) {
    return 'Telefon nömrəsinə hərf yazmaq olmaz. Yalnız rəqəm daxil edin.';
  }

  const local = normalizeAzPhoneLocal(localOrFull);

  if (!local) {
    if (required) {
      return 'Telefon nömrəsi boş ola bilməz. +994-dən sonra 9 rəqəm yazın.';
    }
    return null;
  }

  if (local.length < AZ_PHONE_LOCAL_LENGTH) {
    return `Nömrə natamamdır. +994-dən sonra ${AZ_PHONE_LOCAL_LENGTH} rəqəm olmalıdır.`;
  }

  if (local.length > AZ_PHONE_LOCAL_LENGTH) {
    return `Nömrə çox uzundur. +994-dən sonra ən çox ${AZ_PHONE_LOCAL_LENGTH} rəqəm ola bilər.`;
  }

  return null;
}

/** Yalnız müsbət tam ədəd (≥1). 0, mənfi, onluq, hərf — yazılmır. */
export function sanitizePositiveIntInput(raw: string): string {
  // Yalnız rəqəm; minus/nöqtə/vergül silinir
  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    return '';
  }
  // Başdakı sıfırları sil: "0" → "", "01" → "1", "10" → "10"
  const normalized = digits.replace(/^0+/, '');
  return normalized;
}

/**
 * @deprecated Qiymət də yalnız müsbət tam ədəd — sanitizePositiveIntInput istifadə et.
 * Saxlanılıb ki, köhnə importlar sınmasın; eyni məntiq.
 */
export function sanitizePositiveDecimalInput(raw: string): string {
  return sanitizePositiveIntInput(raw);
}

/** Müsbət tam ədəd (≥1). Boş / 0 / onluq → null. */
export function parsePositiveNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1) {
    return null;
  }
  return value;
}

export const FIELD_EMPTY_PLACEHOLDER = 'Boş ola bilməz';
