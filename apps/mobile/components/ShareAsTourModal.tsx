import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DEFAULT_REGION_ID, REGIONS } from '../constants/regions';
import { colors } from '../constants/theme';
import { getErrorMessage } from '../lib/errors';
import {
  FIELD_EMPTY_PLACEHOLDER,
  formatAzPhoneE164,
  parsePositiveNumber,
  sanitizeAzPhoneLocalInput,
  sanitizeFreeTextWordPatterns,
  sanitizeLettersOnlyInput,
  sanitizePositiveIntInput,
  validateAzPhone,
  validateLettersOnlyField,
} from '../lib/formValidation';
import { isBeforeSelectableHour, nextSelectableHour } from '../lib/listingSchedule';
import { notifyOrganizerNewTour } from '../lib/subscriptions';
import { linkSavedRouteToListing } from '../lib/savedRoutes';
import { supabase } from '../lib/supabase';
import { useInfoToast } from './InfoToastProvider';
import { PhoneField } from './PhoneField';
import { SimpleDateTimeField } from './SimpleDateTimeField';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TourShareStop = {
  name: string;
  lat: number;
  lng: number;
  poiId?: string | null;
};

type FieldErrors = Partial<
  Record<'title' | 'phone' | 'price' | 'capacity' | 'departure' | 'submit', string>
>;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** listing id after successful publish */
  onCreated?: (listingId: string) => void;
  stops: TourShareStop[];
  regionId?: string | null;
  defaultTitle?: string;
  defaultDescription?: string;
  /** Sevimlilərdən paylaşanda — tur yaradılandan sonra bağlanır */
  savedRouteId?: string | null;
};

function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID_RE.test(value);
}

export function ShareAsTourModal({
  visible,
  onClose,
  onCreated,
  stops,
  regionId: initialRegionId,
  defaultTitle,
  defaultDescription,
  savedRouteId,
}: Props) {
  const insets = useSafeAreaInsets();
  const bottomSafe = Math.max(insets.bottom, 12);
  const { showInfo } = useInfoToast();

  const [title, setTitle] = useState('');
  const [departureAt, setDepartureAt] = useState(() => nextSelectableHour());
  const [minDeparture, setMinDeparture] = useState(() => nextSelectableHour());
  const [capacityText, setCapacityText] = useState('');
  const [price, setPrice] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [regionId, setRegionId] = useState(DEFAULT_REGION_ID);
  const [description, setDescription] = useState('');
  const [regionOpen, setRegionOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const uniquePoiIds = useMemo(() => {
    const ids: string[] = [];
    for (const stop of stops) {
      if (isUuid(stop.poiId) && !ids.includes(stop.poiId)) {
        ids.push(stop.poiId);
      }
    }
    return ids;
  }, [stops]);

  const customStopNames = useMemo(
    () => stops.filter((s) => !isUuid(s.poiId)).map((s) => s.name),
    [stops]
  );

  useEffect(() => {
    if (!visible) {
      return;
    }
    const soonest = nextSelectableHour();
    setMinDeparture(soonest);
    setDepartureAt(soonest);
    setTitle(defaultTitle?.trim() || '');
    setCapacityText('');
    setPrice('');
    setContactPhone('');
    setRegionId(initialRegionId || DEFAULT_REGION_ID);
    const routeLines = stops.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
    const baseDesc = defaultDescription?.trim() || '';
    setDescription(
      [baseDesc, routeLines ? `Marşrut:\n${routeLines}` : ''].filter(Boolean).join('\n\n')
    );
    setRegionOpen(false);
    setDateOpen(false);
    setFieldErrors({});
    setLoading(false);
  }, [visible, defaultTitle, defaultDescription, initialRegionId, stops]);

  const regionLabel = REGIONS.find((r) => r.id === regionId)?.label ?? regionId;
  const departureLabel = departureAt.toLocaleString('az-AZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  function clearFieldError(key: keyof FieldErrors) {
    setFieldErrors((prev) => {
      if (!prev[key]) {
        return prev;
      }
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function setFieldError(key: keyof FieldErrors, message: string) {
    setFieldErrors((prev) => ({ ...prev, [key]: message }));
  }

  function handleLettersChange(
    key: 'title',
    text: string,
    setter: (v: string) => void
  ) {
    clearFieldError(key);
    setter(sanitizeLettersOnlyInput(text));
  }

  function handleLettersBlur(key: 'title', value: string, label: string) {
    const err = validateLettersOnlyField(value, label);
    if (err) {
      setFieldError(key, err);
    }
  }

  function collectFieldErrors(): FieldErrors {
    const errors: FieldErrors = {};
    const titleErr = validateLettersOnlyField(title, 'Başlıq');
    if (titleErr) {
      errors.title = titleErr;
    }

    if (isBeforeSelectableHour(departureAt)) {
      errors.departure = 'Tarix keçmiş ola bilməz';
    }

    const tourCapacity = Number(capacityText);
    if (!capacityText || !Number.isFinite(tourCapacity) || tourCapacity <= 0) {
      errors.capacity = 'Nəfər sayı tələb olunur';
    }

    const priceNum = parsePositiveNumber(price);
    if (priceNum == null) {
      errors.price = 'Qiymət tələb olunur';
    }

    const phoneErr = validateAzPhone(contactPhone, true);
    if (phoneErr) {
      errors.phone = phoneErr;
    }

    return errors;
  }

  async function handleSubmit() {
    if (stops.length === 0) {
      setFieldErrors({ submit: 'Marşrutda nöqtə yoxdur.' });
      return;
    }

    const errors = collectFieldErrors();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setLoading(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setFieldErrors({
          submit: userError ? getErrorMessage(userError) : 'Daxil olmaq lazımdır.',
        });
        return;
      }

      const capacityValue = Number(capacityText);
      const priceValue = parsePositiveNumber(price) ?? 0;
      const formattedPhone = formatAzPhoneE164(contactPhone);
      const resolvedTitle = title.trim();

      const routeStopsPayload = stops.map((stop, index) => ({
        name: stop.name,
        lat: stop.lat,
        lng: stop.lng,
        poi_id: isUuid(stop.poiId) ? stop.poiId : null,
        source: isUuid(stop.poiId) ? 'poi' : 'map',
        sort_order: index + 1,
      }));

      const basePayload = {
        created_by: user.id,
        type: 'tour' as const,
        title: resolvedTitle,
        description: description.trim() || null,
        price: priceValue,
        price_type: 'per_person' as const,
        capacity: capacityValue,
        spots_left: capacityValue,
        departure_at: departureAt.toISOString(),
        is_recurring: false,
        origin_text: null,
        destination_text: null,
        region: regionId,
        contact_phone: formattedPhone || null,
        status: 'active' as const,
      };

      let { data: listing, error: insertError } = await supabase
        .from('listings')
        .insert({
          ...basePayload,
          route_stops: routeStopsPayload,
        })
        .select('id')
        .maybeSingle();

      // route_stops sütunu hələ deploy olunmayıbsa — təsvirdəki adlarla davam et
      if (insertError && /route_stops/i.test(insertError.message)) {
        const retry = await supabase
          .from('listings')
          .insert(basePayload)
          .select('id')
          .maybeSingle();
        listing = retry.data;
        insertError = retry.error;
      }

      if (insertError) {
        setFieldErrors({ submit: getErrorMessage(insertError) });
        return;
      }

      let listingId = listing?.id ?? null;
      if (!listingId) {
        const { data: latest } = await supabase
          .from('listings')
          .select('id')
          .eq('created_by', user.id)
          .eq('title', resolvedTitle)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        listingId = latest?.id ?? null;
      }

      if (!listingId) {
        setFieldErrors({ submit: 'Tur yaradılmadı.' });
        return;
      }

      if (uniquePoiIds.length > 0) {
        const { error: rpcError } = await supabase.rpc('set_listing_route_pois', {
          p_listing_id: listingId,
          p_poi_ids: uniquePoiIds,
        });
        if (rpcError) {
          const rows = uniquePoiIds.map((poiId, index) => ({
            listing_id: listingId,
            poi_id: poiId,
            sort_order: index + 1,
          }));
          await supabase.from('listing_pois').insert(rows);
        }
      }

      void notifyOrganizerNewTour({
        organizerId: user.id,
        listingId,
        title: resolvedTitle,
      });

      if (savedRouteId) {
        const link = await linkSavedRouteToListing(savedRouteId, listingId);
        if (link.error) {
          showInfo(`Tur paylaşıldı · ${link.error}`);
        } else {
          showInfo('Tur paylaşıldı · İcma elanlarında görünür');
        }
      } else {
        showInfo('Tur paylaşıldı · İcma elanlarında görünür');
      }
      onCreated?.(listingId);
      onClose();
    } catch (err) {
      setFieldErrors({ submit: getErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }

  function inputStyle(hasError?: boolean) {
    return [styles.input, hasError ? styles.inputError : null];
  }

  function ph(hasError: boolean | undefined, normal: string) {
    return hasError ? FIELD_EMPTY_PLACEHOLDER : normal;
  }

  function phColor(hasError?: boolean) {
    return hasError ? colors.danger : colors.textMuted;
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.sheet, { paddingBottom: bottomSafe }]}>
          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerTitle}>tur kimi paylaş</Text>
              <Text style={styles.headerSubtitle}>Tur elanı üçün məlumatları doldurun</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Text style={styles.closeText}>Bağla</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.stopsHint}>
              Marşrut: {stops.length} nöqtə
              {uniquePoiIds.length > 0 ? ` · ${uniquePoiIds.length} təsdiqli yer` : ''}
              {customStopNames.length > 0
                ? ` · ${customStopNames.length} xəritə pin təsvirə əlavə olundu`
                : ''}
            </Text>

            <Text style={styles.label}>
              Başlıq <Text style={styles.req}>*</Text>
            </Text>
            <TextInput
              style={inputStyle(!!fieldErrors.title)}
              value={title}
              onChangeText={(text) => handleLettersChange('title', text, setTitle)}
              onBlur={() => handleLettersBlur('title', title, 'Başlıq')}
              placeholder={ph(!!fieldErrors.title, 'Quba weekend turu')}
              placeholderTextColor={phColor(!!fieldErrors.title)}
            />
            {fieldErrors.title ? (
              <Text style={styles.fieldHintError}>{fieldErrors.title}</Text>
            ) : null}

            <Pressable
              style={styles.collapse}
              onPress={() => {
                setRegionOpen((o) => !o);
                setDateOpen(false);
              }}
            >
              <Text style={styles.collapseLabel}>
                Region <Text style={styles.req}>*</Text>
              </Text>
              <Text style={styles.collapseValue}>
                {regionOpen ? '▾' : '▸'} {regionLabel}
              </Text>
            </Pressable>
            {regionOpen ? (
              <View style={styles.chipRow}>
                {REGIONS.map((region) => {
                  const selected = region.id === regionId;
                  return (
                    <Pressable
                      key={region.id}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => {
                        setRegionId(region.id);
                        setRegionOpen(false);
                      }}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {region.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <Pressable
              style={styles.collapse}
              onPress={() => {
                setDateOpen((o) => !o);
                setRegionOpen(false);
              }}
            >
              <Text style={styles.collapseLabel}>
                Tarix <Text style={styles.req}>*</Text>
              </Text>
              <Text
                style={[
                  styles.collapseValue,
                  fieldErrors.departure ? styles.collapseValueError : null,
                ]}
              >
                {dateOpen ? '▾' : '▸'} {departureLabel}
              </Text>
            </Pressable>
            {dateOpen ? (
              <SimpleDateTimeField
                value={departureAt}
                onChange={(next) => {
                  clearFieldError('departure');
                  setMinDeparture(nextSelectableHour());
                  setDepartureAt(next);
                }}
                minimumDate={minDeparture}
                hasError={!!fieldErrors.departure}
              />
            ) : null}

            <Text style={styles.label}>
              Nəfər sayı <Text style={styles.req}>*</Text>
            </Text>
            <TextInput
              style={inputStyle(!!fieldErrors.capacity)}
              value={capacityText}
              onChangeText={(text) => {
                clearFieldError('capacity');
                setCapacityText(sanitizePositiveIntInput(text));
              }}
              placeholder={ph(!!fieldErrors.capacity, 'Məs: 5')}
              placeholderTextColor={phColor(!!fieldErrors.capacity)}
              keyboardType="number-pad"
            />

            <Text style={styles.label}>
              Qiymət / nəfər <Text style={styles.req}>*</Text>
            </Text>
            <TextInput
              style={inputStyle(!!fieldErrors.price)}
              value={price}
              onChangeText={(text) => {
                clearFieldError('price');
                setPrice(sanitizePositiveIntInput(text));
              }}
              placeholder={ph(!!fieldErrors.price, 'AZN')}
              placeholderTextColor={phColor(!!fieldErrors.price)}
              keyboardType="number-pad"
            />

            <PhoneField
              label="Əlaqə nömrəsi"
              required
              value={contactPhone}
              onChangeLocal={(local) => {
                clearFieldError('phone');
                setContactPhone(sanitizeAzPhoneLocalInput(local));
              }}
              onValidationError={(err) => {
                if (err) {
                  setFieldError('phone', err);
                } else {
                  clearFieldError('phone');
                }
              }}
              error={fieldErrors.phone ?? null}
            />

            <Text style={styles.label}>Təsvir</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={(text) => setDescription(sanitizeFreeTextWordPatterns(text))}
              placeholder="Tur haqqında..."
              placeholderTextColor={colors.textMuted}
              multiline
              textAlignVertical="top"
            />

            {fieldErrors.submit ? (
              <Text style={styles.submitError}>{fieldErrors.submit}</Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={[styles.submitBtn, loading && styles.submitDisabled]}
              onPress={() => void handleSubmit()}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.textOnAccent} />
              ) : (
                <Text style={styles.submitText}>Turu paylaş</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '92%',
    minHeight: '70%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  headerTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: colors.textMuted,
  },
  closeBtn: {
    paddingVertical: 4,
  },
  closeText: {
    color: colors.accent,
    fontWeight: '600',
    fontSize: 14,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    gap: 6,
  },
  stopsHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 8,
    lineHeight: 17,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 8,
    marginBottom: 4,
  },
  req: {
    color: colors.danger,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.danger,
  },
  textArea: {
    minHeight: 110,
    paddingTop: 11,
  },
  fieldHintError: {
    color: colors.danger,
    fontSize: 12,
    marginTop: 2,
  },
  collapse: {
    marginTop: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  collapseLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  collapseValue: {
    marginTop: 4,
    fontSize: 14,
    color: colors.textSecondary,
  },
  collapseValueError: {
    color: colors.danger,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  chipSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: colors.accent,
    fontWeight: '700',
  },
  submitError: {
    color: colors.danger,
    fontSize: 13,
    marginTop: 10,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSoft,
  },
  submitBtn: {
    backgroundColor: colors.success,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitDisabled: {
    opacity: 0.7,
  },
  submitText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
});
