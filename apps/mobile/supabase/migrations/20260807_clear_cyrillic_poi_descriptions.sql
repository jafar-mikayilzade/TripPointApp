-- Strip non-Azerbaijani (Cyrillic) POI descriptions from lodging imports.
UPDATE public.pois
SET description = NULL
WHERE description ~ '[А-Яа-яЁё]';
