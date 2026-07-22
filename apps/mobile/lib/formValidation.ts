/** Ad / şəhər / başlıq: yalnız hərf və boşluq (rəqəm, nöqtə və digər simvollar silinir). */
export function sanitizeFullNameInput(value: string): string {
  return applyWordLetterInputRules(value.replace(/[^\p{L}\s]/gu, ''));
}

/** Yalnız hərf və boşluq — rəqəm/simvol qadağandır. */
export function sanitizeLettersOnlyInput(value: string): string {
  return sanitizeFullNameInput(value);
}

export const TEXT_FORMAT_ERROR = 'Səhv format';

/** Sözün ilk iki hərfi eyni ola bilməz. */
export const TEXT_DOUBLE_START_ERROR =
  'Hər sözün ilk iki hərfi eyni ola bilməz.';

/** Sözdə yanası 3 eyni hərf ola bilməz. */
export const TEXT_TRIPLE_LETTER_ERROR =
  'Sözdə yanası 3 eyni hərf ola bilməz.';

/** Mətndə hərf/boşluqdan başqa simvol varmı (sanitize-dən əvvəl). */
export function hasDisallowedTextSymbols(value: string): boolean {
  return /[^\p{L}\s]/u.test(value);
}

function normalizeLetter(ch: string): string {
  return ch.toLocaleLowerCase('az-AZ');
}

/** Yazarkən: ilk iki eyni hərf və yanası 3 eyni hərf qəbul olunmur. */
function applyWordLetterInputRules(value: string): string {
  const parts = value.split(/(\s+)/);
  return parts
    .map((part) => {
      if (!part || /^\s+$/.test(part)) {
        return part;
      }
      return sanitizeWordLetters(part);
    })
    .join('');
}

function sanitizeWordLetters(word: string): string {
  const chars = [...word];
  const out: string[] = [];

  for (const ch of chars) {
    const n = normalizeLetter(ch);

    // İlk iki hərf eyni ola bilməz
    if (out.length === 1 && normalizeLetter(out[0]) === n) {
      continue;
    }

    // Yanası 3 eyni hərf ola bilməz
    if (
      out.length >= 2 &&
      normalizeLetter(out[out.length - 1]) === n &&
      normalizeLetter(out[out.length - 2]) === n
    ) {
      continue;
    }

    out.push(ch);
  }

  return out.join('');
}

/**
 * Sərbəst mətn (təsvir və s.): digər simvollar qalır,
 * yalnız hərf ardıcıllıqlarına söz qaydaları tətbiq olunur.
 */
export function sanitizeFreeTextWordPatterns(value: string): string {
  return value.replace(/\p{L}+/gu, (run) => sanitizeWordLetters(run));
}

/**
 * Müstəqil sözlər üzrə qaydalar:
 * 1) hər sözün ilk iki hərfi eyni ola bilməz
 * 2) söz daxilində yanası 3 eyni hərf ola bilməz
 */
export function validateTextWordPatterns(value: string): string | null {
  const words = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  for (const word of words) {
    // Yalnız hərf hissəsini yoxla (təsvirdə rəqəm/simvol qarışıq olsa belə)
    const letterRuns = word.match(/\p{L}+/gu) ?? [];
    for (const run of letterRuns) {
      const letters = [...run];

      if (
        letters.length >= 2 &&
        normalizeLetter(letters[0]) === normalizeLetter(letters[1])
      ) {
        return TEXT_DOUBLE_START_ERROR;
      }

      let streak = 1;
      for (let i = 1; i < letters.length; i += 1) {
        if (normalizeLetter(letters[i]) === normalizeLetter(letters[i - 1])) {
          streak += 1;
          if (streak >= 3) {
            return TEXT_TRIPLE_LETTER_ERROR;
          }
        } else {
          streak = 1;
        }
      }
    }
  }

  return null;
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

  if (hasDisallowedTextSymbols(value) || /[0-9۰-۹٠-٩]/.test(value)) {
    return TEXT_FORMAT_ERROR;
  }

  if (trimmed.length < minLength) {
    return `${fieldLabel} ən azı ${minLength} hərf olmalıdır.`;
  }

  if (!/^[\p{L}\s]+$/u.test(trimmed)) {
    return TEXT_FORMAT_ERROR;
  }

  const patternError = validateTextWordPatterns(trimmed);
  if (patternError) {
    return patternError;
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
 * İcazəli operator prefiksləri (0 ilə və ya 0-sız):
 * 010, 050, 051, 055, 060, 070, 077, 099
 */
export const AZ_MOBILE_OPERATOR_PREFIXES = [
  '10',
  '50',
  '51',
  '55',
  '60',
  '70',
  '77',
  '99',
] as const;

export const AZ_PHONE_FORMAT_ERROR = 'prefix:10, 50, 51, 55,60,70, 77, 99';

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

function hasValidAzMobileOperator(localDigits: string): boolean {
  if (localDigits.length < 2) {
    return false;
  }
  const prefix = localDigits.slice(0, 2);
  return (AZ_MOBILE_OPERATOR_PREFIXES as readonly string[]).includes(prefix);
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
    return AZ_PHONE_FORMAT_ERROR;
  }

  const local = normalizeAzPhoneLocal(localOrFull);

  if (!local) {
    if (required) {
      return 'Telefon nömrəsi boş ola bilməz. +994-dən sonra 9 rəqəm yazın.';
    }
    return null;
  }

  if (local.length !== AZ_PHONE_LOCAL_LENGTH) {
    return AZ_PHONE_FORMAT_ERROR;
  }

  if (!hasValidAzMobileOperator(local)) {
    return AZ_PHONE_FORMAT_ERROR;
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
