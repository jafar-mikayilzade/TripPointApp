-- profiles silinib, auth.users qalıb olan orphan hesabları təmizlə
-- Diqqət: yalnız profiles-i olmayan auth istifadəçiləri

DELETE FROM auth.identities
WHERE user_id IN (
  SELECT u.id
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE p.id IS NULL
);

DELETE FROM auth.users
WHERE id IN (
  SELECT u.id
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE p.id IS NULL
);
