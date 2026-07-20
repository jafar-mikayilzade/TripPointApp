export function getErrorMessage(error: unknown): string {
  if (!error) {
    return '';
  }

  const msg =
    (typeof error === 'object' &&
      error !== null &&
      ('message' in error || 'error_description' in error) &&
      String(
        (error as { message?: unknown; error_description?: unknown }).message ||
          (error as { error_description?: unknown }).error_description ||
          ''
      )) ||
    String(error) ||
    '';

  // Auth xətaları
  if (msg.includes('Invalid login credentials')) {
    return 'Email və ya şifrə yanlışdır';
  }
  if (msg.includes('Email not confirmed')) {
    return 'Email təsdiqlənməyib. Poçtdakı linkə basın, sonra yenidən daxil olun.';
  }
  if (msg.includes('User already registered')) {
    return 'Bu email artıq qeydiyyatdan keçib';
  }
  if (msg.includes('Password should be at least')) {
    return 'Şifrə ən azı 8 simvol olmalıdır və böyük/kiçik hərf ilə rəqəm daxil etməlidir';
  }
  if (msg.includes('rate limit') || msg.includes('Rate limit')) {
    return 'Çox sayda cəhd. Bir az gözləyin';
  }
  if (msg.includes('signup is disabled')) {
    return 'Qeydiyyat müvəqqəti bağlıdır';
  }

  // DB xətaları
  if (msg.includes('violates check constraint')) {
    return 'Məlumat formatı yanlışdır';
  }
  if (msg.includes('violates foreign key')) {
    return 'Əlaqəli məlumat tapılmadı';
  }
  if (msg.includes('duplicate key') || msg.includes('unique')) {
    return 'Bu məlumat artıq mövcuddur';
  }
  if (msg.includes('not-null constraint')) {
    return 'Məcburi sahə boş buraxılıb';
  }
  if (msg.includes('infinite recursion')) {
    return 'Sistem xətası. Adminə bildirin';
  }
  if (msg.includes('column') && msg.includes('does not exist')) {
    return 'Sistem xətası. Adminə bildirin';
  }
  if (/Could not find the '[^']+' column/i.test(msg)) {
    return 'Verilənlər bazası sahəsi tapılmadı. Yeniləmə/migration lazımdır.';
  }
  if (msg.includes('permission denied') || msg.includes('row-level security')) {
    return 'Bu əməliyyat üçün icazəniz yoxdur';
  }

  // Storage xətaları
  if (msg.includes('Direct deletion from storage tables is not allowed')) {
    return 'Fayllar silinə bilmədi. Yenidən cəhd edin.';
  }
  if (msg.includes('Bucket not found')) {
    return 'Fayl yükləmə xidməti hazır deyil';
  }
  if (msg.includes('The object exceeded the maximum allowed size')) {
    return 'Fayl həcmi çox böyükdür (maks. 5MB)';
  }
  if (msg.includes('Invalid image')) {
    return 'Şəkil formatı dəstəklənmir';
  }

  // Şəbəkə xətaları
  if (msg.includes('Failed to fetch') || msg.includes('Network request failed')) {
    return 'İnternet bağlantısı yoxdur';
  }
  if (msg.includes('timeout')) {
    return 'Bağlantı vaxtı bitdi. Yenidən cəhd edin';
  }

  // Ümumi
  if (msg.includes('not found') || msg.includes('404')) {
    return 'Məlumat tapılmadı';
  }
  if (msg.includes('unauthorized') || msg.includes('401')) {
    return 'Giriş tələb olunur';
  }

  return 'Xəta baş verdi. Yenidən cəhd edin';
}
