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

import { DEFAULT_REGION_ID, REGIONS } from '../constants/regions';
import { getErrorMessage } from '../lib/errors';
import {
  FIELD_EMPTY_PLACEHOLDER,
  buildCarpoolTitle,
  formatAzPhoneE164,
  parsePositiveNumber,
  sanitizeAzPhoneLocalInput,
  sanitizeLettersOnlyInput,
  sanitizePositiveIntInput,
  validateAzPhone,
  validateLettersOnlyField,
} from '../lib/formValidation';
import { isBeforeSelectableHour, nextSelectableHour } from '../lib/listingSchedule';
import { supabase } from '../lib/supabase';
import type {
  ListingPriceType,
  ListingType,
  LocalServiceCategory,
  Poi,
} from '../types/database';
import { PhoneField } from './PhoneField';
import { SimpleDateTimeField } from './SimpleDateTimeField';

import { colors } from '../constants/theme';

interface CreateListingModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}

type FieldErrors = Partial<
  Record<
    'title' | 'origin' | 'destination' | 'phone' | 'price' | 'capacity' | 'departure' | 'submit',
    string
  >
>;

const TYPE_CARDS: { type: ListingType; emoji: string; title: string; subtitle: string }[] = [
  {
    type: 'tour',
    emoji: '🗺',
    title: 'Tur',
    subtitle: 'Qrup turu təşkil edirəm',
  },
  {
    type: 'local_service',
    emoji: '🏔',
    title: 'Yerli Xidmət',
    subtitle: 'Yerli olaraq xidmət təklif edirəm',
  },
  {
    type: 'carpool',
    emoji: '🚗',
    title: 'Carpool',
    subtitle: 'Şəxsi maşınımla gedirəm, yer var',
  },
];

const POI_PAGE_SIZE = 8;

const SERVICE_CATEGORIES: { value: LocalServiceCategory; label: string }[] = [
  { value: 'offroad', label: 'Offroad nəqliyyat' },
  { value: 'private_guide', label: 'Şəxsi bələdçi' },
  { value: 'home_rental', label: 'Ev kirayəsi' },
  { value: 'other_service', label: 'Digər xidmət' },
];

const PRICE_TYPES: { value: ListingPriceType; label: string }[] = [
  { value: 'per_person', label: 'Nəfər başına' },
  { value: 'per_trip', label: 'Səfər başına' },
  { value: 'negotiable', label: 'Razılaşma ilə' },
  { value: 'free', label: 'Pulsuz' },
];

export function CreateListingModal({ visible, onClose, onCreated }: CreateListingModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [listingType, setListingType] = useState<ListingType | null>(null);

  const [title, setTitle] = useState('');
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [departureAt, setDepartureAt] = useState(() => nextSelectableHour());
  const [capacity, setCapacity] = useState(3);
  const [capacityText, setCapacityText] = useState('');
  const [price, setPrice] = useState('');
  const [isFree, setIsFree] = useState(false);
  const [contactPhone, setContactPhone] = useState('');
  const [regionId, setRegionId] = useState(DEFAULT_REGION_ID);
  const [description, setDescription] = useState('');
  const [selectedPoiIds, setSelectedPoiIds] = useState<string[]>([]);
  const [approvedPois, setApprovedPois] = useState<Poi[]>([]);
  const [loadingPois, setLoadingPois] = useState(false);
  const [poiPickerOpen, setPoiPickerOpen] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [poiPage, setPoiPage] = useState(0);
  const [serviceCategory, setServiceCategory] = useState<LocalServiceCategory>('private_guide');
  const [priceType, setPriceType] = useState<ListingPriceType>('per_person');
  const [isRecurring, setIsRecurring] = useState(false);

  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [minDeparture, setMinDeparture] = useState(() => nextSelectableHour());

  useEffect(() => {
    if (!visible) {
      return;
    }

    setStep(1);
    setListingType(null);
    setTitle('');
    setOriginText('');
    setDestinationText('');
    const soonest = nextSelectableHour();
    setMinDeparture(soonest);
    setDepartureAt(soonest);
    setCapacity(3);
    setCapacityText('');
    setPrice('');
    setIsFree(false);
    setContactPhone('');
    setRegionId(DEFAULT_REGION_ID);
    setDescription('');
    setSelectedPoiIds([]);
    setPoiPickerOpen(false);
    setRegionOpen(false);
    setDateOpen(false);
    setPoiPage(0);
    setServiceCategory('private_guide');
    setPriceType('per_person');
    setIsRecurring(false);
    setFieldErrors({});
    setLoading(false);
  }, [visible]);

  useEffect(() => {
    if (listingType !== 'carpool') {
      return;
    }
    if (originText.trim() && destinationText.trim()) {
      setTitle(buildCarpoolTitle(originText, destinationText));
    }
  }, [listingType, originText, destinationText]);

  useEffect(() => {
    const needsRoute = listingType === 'tour' || listingType === 'carpool';
    if (!visible || !needsRoute || step !== 2 || !poiPickerOpen) {
      return;
    }

    let isActive = true;

    async function loadPois() {
      setLoadingPois(true);
      const { data, error } = await supabase
        .from('pois')
        .select('*')
        .eq('status', 'approved')
        .eq('region', regionId)
        .order('name');

      if (!isActive) {
        return;
      }

      if (error) {
        setFieldErrors((prev) => ({ ...prev, submit: getErrorMessage(error) }));
        setApprovedPois([]);
      } else {
        setApprovedPois(data ?? []);
      }
      setLoadingPois(false);
    }

    loadPois();
    return () => {
      isActive = false;
    };
  }, [visible, listingType, step, regionId, poiPickerOpen]);

  useEffect(() => {
    setPoiPage(0);
    setSelectedPoiIds([]);
  }, [regionId]);

  const regionLabel = REGIONS.find((item) => item.id === regionId)?.label ?? regionId;
  const departureLabel = formatDepartureLabel(departureAt);

  const poiTotalPages = Math.max(1, Math.ceil(approvedPois.length / POI_PAGE_SIZE));
  const pagedPois = useMemo(() => {
    const start = poiPage * POI_PAGE_SIZE;
    return approvedPois.slice(start, start + POI_PAGE_SIZE);
  }, [approvedPois, poiPage]);

  const parsedPrice = useMemo(() => {
    if (isFree || priceType === 'free' || priceType === 'negotiable') {
      return null;
    }
    return parsePositiveNumber(price);
  }, [isFree, price, priceType]);

  function resolvePriceFields(): {
    price: number | null;
    price_type: ListingPriceType;
  } {
    if (listingType === 'carpool') {
      if (isFree) {
        return { price: null, price_type: 'free' };
      }
      return { price: parsedPrice, price_type: 'per_person' };
    }

    if (listingType === 'tour') {
      return { price: parsedPrice, price_type: 'per_person' };
    }

    // local_service
    const allowed: ListingPriceType[] = ['per_person', 'per_trip', 'negotiable', 'free'];
    const safeType = allowed.includes(priceType) ? priceType : 'per_person';

    if (safeType === 'free') {
      return { price: null, price_type: 'free' };
    }
    if (safeType === 'negotiable') {
      return { price: null, price_type: 'negotiable' };
    }
    return { price: parsedPrice, price_type: safeType };
  }

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

  function selectType(type: ListingType) {
    const soonest = nextSelectableHour();
    setMinDeparture(soonest);
    setDepartureAt(soonest);
    setListingType(type);
    setStep(2);
    setFieldErrors({});
    if (type === 'tour') {
      setPriceType('per_person');
      setIsFree(false);
      setCapacityText('');
    }
    if (type === 'local_service') {
      setPriceType('per_person');
    }
  }

  function togglePoi(poiId: string) {
    setSelectedPoiIds((current) =>
      current.includes(poiId) ? current.filter((id) => id !== poiId) : [...current, poiId]
    );
  }

  function collectFieldErrors(): FieldErrors {
    const errors: FieldErrors = {};
    if (!listingType) {
      errors.submit = 'Tip seçin.';
      return errors;
    }

    if (
      (listingType === 'carpool' || listingType === 'tour') &&
      isBeforeSelectableHour(departureAt)
    ) {
      errors.departure = 'past';
    }

    if (listingType === 'carpool') {
      if (validateLettersOnlyField(originText, 'Haradan')) {
        errors.origin = 'empty';
      }
      if (validateLettersOnlyField(destinationText, 'Haraya')) {
        errors.destination = 'empty';
      }
      if (!isFree && parsedPrice === null) {
        errors.price = 'empty';
      }
      if (validateAzPhone(contactPhone, true)) {
        errors.phone = 'empty';
      }
    }

    if (listingType === 'tour') {
      if (validateLettersOnlyField(title, 'Başlıq')) {
        errors.title = 'empty';
      }
      if (parsedPrice === null) {
        errors.price = 'empty';
      }
      const tourCapacity = Number(capacityText);
      if (!capacityText || !Number.isFinite(tourCapacity) || tourCapacity <= 0) {
        errors.capacity = 'empty';
      }
      if (validateAzPhone(contactPhone, true)) {
        errors.phone = 'empty';
      }
    }

    if (listingType === 'local_service') {
      if (validateLettersOnlyField(title, 'Başlıq')) {
        errors.title = 'empty';
      }
      if (priceType !== 'free' && priceType !== 'negotiable' && parsedPrice === null) {
        errors.price = 'empty';
      }
      if (validateAzPhone(contactPhone, true)) {
        errors.phone = 'empty';
      }
    }

    return errors;
  }

  async function handleSubmit() {
    if (!listingType) {
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

      let resolvedTitle = title.trim();
      if (listingType === 'carpool') {
        resolvedTitle = buildCarpoolTitle(originText, destinationText);
      }

      const capacityValue =
        listingType === 'local_service'
          ? null
          : listingType === 'tour'
            ? Number(capacityText)
            : capacity;
      const { price: priceValue, price_type: priceTypeValue } = resolvePriceFields();
      const formattedPhone = formatAzPhoneE164(contactPhone);

      let descriptionValue = description.trim() || null;
      if (listingType === 'local_service') {
        const catLabel =
          SERVICE_CATEGORIES.find((c) => c.value === serviceCategory)?.label ?? serviceCategory;
        descriptionValue = descriptionValue ? `${catLabel}\n\n${descriptionValue}` : catLabel;
      }

      const payload = {
        created_by: user.id,
        type: listingType,
        title: resolvedTitle,
        description: descriptionValue,
        price: priceValue,
        price_type: priceTypeValue,
        capacity: capacityValue,
        spots_left: capacityValue,
        departure_at:
          listingType === 'carpool' || listingType === 'tour' ? departureAt.toISOString() : null,
        is_recurring: listingType === 'local_service' ? isRecurring : false,
        origin_text: listingType === 'carpool' ? originText.trim() : null,
        destination_text: listingType === 'carpool' ? destinationText.trim() : null,
        region: listingType === 'carpool' ? null : regionId,
        contact_phone: formattedPhone || null,
        status: 'active' as const,
      };

      const { data: listing, error: insertError } = await supabase
        .from('listings')
        .insert(payload)
        .select('id')
        .maybeSingle();

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
        setFieldErrors({ submit: 'Elan yaradılmadı.' });
        return;
      }

      if (
        (listingType === 'tour' || listingType === 'carpool') &&
        selectedPoiIds.length > 0
      ) {
        const { error: rpcError } = await supabase.rpc('set_listing_route_pois', {
          p_listing_id: listingId,
          p_poi_ids: selectedPoiIds,
        });
        if (rpcError) {
          const rows = selectedPoiIds.map((poiId, index) => ({
            listing_id: listingId,
            poi_id: poiId,
            sort_order: index + 1,
          }));
          const { error: poisError } = await supabase.from('listing_pois').insert(rows);
          if (poisError) {
            setFieldErrors({
              submit: `Elan yaradıldı, amma marşrut yerləri yazılmadı: ${getErrorMessage(poisError)}`,
            });
            onCreated();
            onClose();
            return;
          }
        }
      }

      onCreated();
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
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {step === 1 ? 'Elan tipi seç' : 'Elan məlumatları'}
            </Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.closeText}>Bağla</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.content,
              step === 2 && styles.contentWithFooter,
            ]}
          >
            {step === 1 ? (
              <View style={styles.typeList}>
                {TYPE_CARDS.map((card) => (
                  <Pressable
                    key={card.type}
                    style={styles.typeCard}
                    onPress={() => selectType(card.type)}
                  >
                    <Text style={styles.typeEmoji}>{card.emoji}</Text>
                    <View style={styles.typeTextWrap}>
                      <Text style={styles.typeTitle}>{card.title}</Text>
                      <Text style={styles.typeSubtitle}>{card.subtitle}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {step === 2 && listingType === 'carpool' ? (
              <>
                <FieldLabel text="Haradan" required />
                <TextInput
                  style={inputStyle(!!fieldErrors.origin)}
                  value={originText}
                  onChangeText={(text) => {
                    clearFieldError('origin');
                    setOriginText(sanitizeLettersOnlyInput(text));
                  }}
                  placeholder={ph(!!fieldErrors.origin, 'Bakı')}
                  placeholderTextColor={phColor(!!fieldErrors.origin)}
                />

                <FieldLabel text="Haraya" required />
                <TextInput
                  style={inputStyle(!!fieldErrors.destination)}
                  value={destinationText}
                  onChangeText={(text) => {
                    clearFieldError('destination');
                    setDestinationText(sanitizeLettersOnlyInput(text));
                  }}
                  placeholder={ph(!!fieldErrors.destination, 'Quba')}
                  placeholderTextColor={phColor(!!fieldErrors.destination)}
                />

                <FieldLabel text="Başlıq" required />
                <TextInput
                  style={[styles.input, styles.inputDisabled]}
                  value={title}
                  editable={false}
                  placeholder="Bakı Quba istiqamətində gedirəm"
                  placeholderTextColor={colors.textMuted}
                />

                <CollapseToggle
                  open={dateOpen}
                  label="Tarix və saat"
                  value={departureLabel}
                  required
                  hasError={!!fieldErrors.departure}
                  onPress={() => {
                    setDateOpen((open) => !open);
                    setRegionOpen(false);
                  }}
                />
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

                <FieldLabel text="Yer sayı" required />
                <View style={styles.chipRow}>
                  {Array.from({ length: 8 }, (_, i) => i + 1).map((value) => {
                    const selected = capacity === value;
                    return (
                      <Pressable
                        key={value}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setCapacity(value)}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {value}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <FieldLabel text="Qiymət" />
                <TextInput
                  style={[
                    ...inputStyle(!!fieldErrors.price),
                    isFree ? styles.inputDisabled : null,
                  ]}
                  value={price}
                  onChangeText={(text) => {
                    clearFieldError('price');
                    setPrice(sanitizePositiveIntInput(text));
                  }}
                  placeholder={ph(!!fieldErrors.price, 'AZN')}
                  placeholderTextColor={phColor(!!fieldErrors.price)}
                  keyboardType="number-pad"
                  editable={!isFree}
                />
                <Pressable
                  style={styles.checkboxRow}
                  onPress={() => {
                    clearFieldError('price');
                    setIsFree((current) => !current);
                    if (!isFree) {
                      setPrice('');
                    }
                  }}
                >
                  <View style={[styles.checkbox, isFree && styles.checkboxChecked]} />
                  <Text style={styles.checkboxLabel}>Pulsuz</Text>
                </Pressable>

                <PhoneField
                  label="Əlaqə nömrəsi"
                  required
                  value={contactPhone}
                  onChangeLocal={(local) => {
                    clearFieldError('phone');
                    setContactPhone(sanitizeAzPhoneLocalInput(local));
                  }}
                  error={fieldErrors.phone ? FIELD_EMPTY_PLACEHOLDER : null}
                />

                <CollapseToggle
                  open={regionOpen}
                  label="Region"
                  value={regionLabel}
                  onPress={() => {
                    setRegionOpen((open) => !open);
                    setDateOpen(false);
                  }}
                />
                {regionOpen ? (
                  <View style={styles.chipRowWrap}>
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
                  style={styles.poiToggle}
                  onPress={() => {
                    setPoiPickerOpen((open) => !open);
                    if (!poiPickerOpen) {
                      setPoiPage(0);
                    }
                  }}
                >
                  <Text style={styles.poiToggleText}>
                    {poiPickerOpen ? '▾' : '▸'} Marşrut nöqtələri əlavə et
                    {selectedPoiIds.length > 0 ? ` (${selectedPoiIds.length})` : ''}
                  </Text>
                </Pressable>

                {poiPickerOpen ? (
                  <View style={styles.poiPickerBox}>
                    {loadingPois ? (
                      <ActivityIndicator color={colors.accent} />
                    ) : approvedPois.length === 0 ? (
                      <Text style={styles.muted}>Bu regionda təsdiqlənmiş yer yoxdur</Text>
                    ) : (
                      <>
                        {pagedPois.map((poi) => {
                          const selected = selectedPoiIds.includes(poi.id);
                          return (
                            <Pressable
                              key={poi.id}
                              style={[styles.poiRow, selected && styles.poiRowSelected]}
                              onPress={() => togglePoi(poi.id)}
                            >
                              <Text style={styles.poiName}>{poi.name}</Text>
                              <Text style={styles.poiCheck}>{selected ? '✓' : '+'}</Text>
                            </Pressable>
                          );
                        })}
                        {poiTotalPages > 1 ? (
                          <View style={styles.poiPager}>
                            <Pressable
                              style={[styles.pagerBtn, poiPage === 0 && styles.pagerBtnDisabled]}
                              disabled={poiPage === 0}
                              onPress={() => setPoiPage((p) => Math.max(0, p - 1))}
                            >
                              <Text style={styles.pagerBtnText}>Əvvəlki</Text>
                            </Pressable>
                            <Text style={styles.pagerMeta}>
                              {poiPage + 1} / {poiTotalPages}
                            </Text>
                            <Pressable
                              style={[
                                styles.pagerBtn,
                                poiPage >= poiTotalPages - 1 && styles.pagerBtnDisabled,
                              ]}
                              disabled={poiPage >= poiTotalPages - 1}
                              onPress={() =>
                                setPoiPage((p) => Math.min(poiTotalPages - 1, p + 1))
                              }
                            >
                              <Text style={styles.pagerBtnText}>Növbəti</Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </>
                    )}
                  </View>
                ) : null}

                <FieldLabel text="Təsvir" />
                <TextInput
                  style={[styles.input, description.trim().length > 0 && styles.textAreaGrowing]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Qısa qeyd (istəyə bağlı)"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  textAlignVertical={description.trim().length > 0 ? 'top' : 'center'}
                />
              </>
            ) : null}

            {step === 2 && listingType === 'tour' ? (
              <>
                <FieldLabel text="Başlıq" required />
                <TextInput
                  style={inputStyle(!!fieldErrors.title)}
                  value={title}
                  onChangeText={(text) => {
                    clearFieldError('title');
                    setTitle(sanitizeLettersOnlyInput(text));
                  }}
                  placeholder={ph(!!fieldErrors.title, 'Quba weekend turu')}
                  placeholderTextColor={phColor(!!fieldErrors.title)}
                />

                <CollapseToggle
                  open={regionOpen}
                  label="Region"
                  value={regionLabel}
                  required
                  onPress={() => {
                    setRegionOpen((open) => !open);
                    setDateOpen(false);
                  }}
                />
                {regionOpen ? (
                  <View style={styles.chipRowWrap}>
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

                <CollapseToggle
                  open={dateOpen}
                  label="Tarix"
                  value={departureLabel}
                  required
                  hasError={!!fieldErrors.departure}
                  onPress={() => {
                    setDateOpen((open) => !open);
                    setRegionOpen(false);
                  }}
                />
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

                <FieldLabel text="Nəfər sayı" required />
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

                <FieldLabel text="Qiymət / nəfər" required />
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
                  error={fieldErrors.phone ? FIELD_EMPTY_PLACEHOLDER : null}
                />

                <Pressable
                  style={styles.poiToggle}
                  onPress={() => {
                    setPoiPickerOpen((open) => !open);
                    if (!poiPickerOpen) {
                      setPoiPage(0);
                    }
                  }}
                >
                  <Text style={styles.poiToggleText}>
                    {poiPickerOpen ? '▾' : '▸'} Marşrut nöqtələri əlavə et
                    {selectedPoiIds.length > 0 ? ` (${selectedPoiIds.length})` : ''}
                  </Text>
                </Pressable>

                {poiPickerOpen ? (
                  <View style={styles.poiPickerBox}>
                    {loadingPois ? (
                      <ActivityIndicator color={colors.accent} />
                    ) : approvedPois.length === 0 ? (
                      <Text style={styles.muted}>Bu regionda təsdiqlənmiş yer yoxdur</Text>
                    ) : (
                      <>
                        {pagedPois.map((poi) => {
                          const selected = selectedPoiIds.includes(poi.id);
                          return (
                            <Pressable
                              key={poi.id}
                              style={[styles.poiRow, selected && styles.poiRowSelected]}
                              onPress={() => togglePoi(poi.id)}
                            >
                              <Text style={styles.poiName}>{poi.name}</Text>
                              <Text style={styles.poiCheck}>{selected ? '✓' : '+'}</Text>
                            </Pressable>
                          );
                        })}
                        {poiTotalPages > 1 ? (
                          <View style={styles.poiPager}>
                            <Pressable
                              style={[styles.pagerBtn, poiPage === 0 && styles.pagerBtnDisabled]}
                              disabled={poiPage === 0}
                              onPress={() => setPoiPage((p) => Math.max(0, p - 1))}
                            >
                              <Text style={styles.pagerBtnText}>Əvvəlki</Text>
                            </Pressable>
                            <Text style={styles.pagerMeta}>
                              {poiPage + 1} / {poiTotalPages}
                            </Text>
                            <Pressable
                              style={[
                                styles.pagerBtn,
                                poiPage >= poiTotalPages - 1 && styles.pagerBtnDisabled,
                              ]}
                              disabled={poiPage >= poiTotalPages - 1}
                              onPress={() =>
                                setPoiPage((p) => Math.min(poiTotalPages - 1, p + 1))
                              }
                            >
                              <Text style={styles.pagerBtnText}>Növbəti</Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </>
                    )}
                  </View>
                ) : null}

                <FieldLabel text="Təsvir" />
                <TextInput
                  style={[styles.input, description.trim().length > 0 && styles.textAreaGrowing]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Tur haqqında..."
                  placeholderTextColor={colors.textMuted}
                  multiline
                  textAlignVertical={description.trim().length > 0 ? 'top' : 'center'}
                />
              </>
            ) : null}

            {step === 2 && listingType === 'local_service' ? (
              <>
                <FieldLabel text="Başlıq" required />
                <TextInput
                  style={inputStyle(!!fieldErrors.title)}
                  value={title}
                  onChangeText={(text) => {
                    clearFieldError('title');
                    setTitle(sanitizeLettersOnlyInput(text));
                  }}
                  placeholder={ph(!!fieldErrors.title, 'Offroad jeep turu')}
                  placeholderTextColor={phColor(!!fieldErrors.title)}
                />

                <FieldLabel text="Xidmət kateqoriyası" required />
                <View style={styles.chipRowWrap}>
                  {SERVICE_CATEGORIES.map((item) => {
                    const selected = serviceCategory === item.value;
                    return (
                      <Pressable
                        key={item.value}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setServiceCategory(item.value)}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <CollapseToggle
                  open={regionOpen}
                  label="Region"
                  value={regionLabel}
                  required
                  onPress={() => {
                    setRegionOpen((open) => !open);
                    setDateOpen(false);
                  }}
                />
                {regionOpen ? (
                  <View style={styles.chipRowWrap}>
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

                <FieldLabel text="Qiymət tipi" required />
                <View style={styles.chipRowWrap}>
                  {PRICE_TYPES.map((item) => {
                    const selected = priceType === item.value;
                    return (
                      <Pressable
                        key={item.value}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => {
                          clearFieldError('price');
                          setPriceType(item.value);
                          if (item.value === 'free' || item.value === 'negotiable') {
                            setPrice('');
                          }
                        }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {priceType !== 'free' && priceType !== 'negotiable' ? (
                  <>
                    <FieldLabel text="Qiymət" required />
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
                  </>
                ) : null}

                <Pressable
                  style={styles.checkboxRow}
                  onPress={() => setIsRecurring((current) => !current)}
                >
                  <View style={[styles.checkbox, isRecurring && styles.checkboxChecked]} />
                  <Text style={styles.checkboxLabel}>Daimi xidmət</Text>
                </Pressable>

                <PhoneField
                  label="Əlaqə nömrəsi"
                  required
                  value={contactPhone}
                  onChangeLocal={(local) => {
                    clearFieldError('phone');
                    setContactPhone(sanitizeAzPhoneLocalInput(local));
                  }}
                  error={fieldErrors.phone ? FIELD_EMPTY_PLACEHOLDER : null}
                />

                <FieldLabel text="Ətraflı təsvir" />
                <TextInput
                  style={[styles.input, description.trim().length > 0 && styles.textAreaGrowing]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Xidmət haqqında..."
                  placeholderTextColor={colors.textMuted}
                  multiline
                  textAlignVertical={description.trim().length > 0 ? 'top' : 'center'}
                />
              </>
            ) : null}

            {fieldErrors.submit ? (
              <Text style={styles.submitError}>{fieldErrors.submit}</Text>
            ) : null}
          </ScrollView>

          {step === 2 ? (
            <View style={styles.footerBar}>
              <Pressable
                style={styles.backButton}
                onPress={() => {
                  setStep(1);
                  setFieldErrors({});
                  setPoiPickerOpen(false);
                  setRegionOpen(false);
                  setDateOpen(false);
                }}
                disabled={loading}
              >
                <Text style={styles.backButtonText}>Geri</Text>
              </Pressable>
              <Pressable
                style={[styles.submitButton, loading && styles.submitDisabled]}
                onPress={handleSubmit}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitButtonText}>Göndər</Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function formatDepartureLabel(date: Date): string {
  const d = date.toLocaleDateString('az-AZ', {
    day: '2-digit',
    month: 'short',
  });
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${d} · ${h}:${m}`;
}

function FieldLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <Text style={styles.label}>
      {text}
      {required ? <Text style={styles.required}> *</Text> : null}
    </Text>
  );
}

function CollapseToggle({
  open,
  label,
  value,
  required,
  hasError,
  onPress,
}: {
  open: boolean;
  label: string;
  value?: string;
  required?: boolean;
  hasError?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.collapseToggle, hasError && styles.collapseToggleError]}
      onPress={onPress}
    >
      <Text
        style={[styles.collapseToggleText, hasError && styles.collapseToggleTextError]}
        numberOfLines={1}
      >
        {open ? '▾' : '▸'} {label}
        {required ? ' *' : ''}
        {!open && value ? ` · ${value}` : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  sheet: {
    maxHeight: '92%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    overflow: 'hidden',
  },
  scroll: {
    flexGrow: 1,
    flexShrink: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  closeText: {
    color: colors.accent,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    flexGrow: 1,
  },
  contentWithFooter: {
    paddingBottom: 12,
  },
  typeList: {
    gap: 12,
    marginTop: 8,
  },
  typeCard: {
    borderRadius: 24,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  typeEmoji: {
    fontSize: 28,
  },
  typeTextWrap: {
    flex: 1,
  },
  typeTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  typeSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: colors.textSecondary,
  },
  label: {
    marginTop: 14,
    marginBottom: 6,
    fontSize: 13,
    fontWeight: '700',
    color: colors.chipText,
  },
  required: {
    color: colors.danger,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.danger,
  },
  inputDisabled: {
    backgroundColor: colors.chip,
    color: colors.textMuted,
  },
  textArea: {
    minHeight: 90,
  },
  textAreaGrowing: {
    minHeight: 96,
    paddingTop: 11,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chipRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: colors.chip,
  },
  chipSelected: {
    backgroundColor: colors.chipSelected,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.chipText,
  },
  chipTextSelected: {
    color: colors.textOnAccent,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.textMuted,
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkboxLabel: {
    fontSize: 14,
    color: colors.chipText,
    fontWeight: '600',
  },
  poiRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  poiRowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  poiName: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
  },
  poiCheck: {
    fontSize: 16,
    color: colors.accent,
    fontWeight: '700',
  },
  muted: {
    color: colors.textMuted,
    fontSize: 13,
  },
  poiToggle: {
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  poiToggleText: {
    color: colors.accentPressed,
    fontWeight: '700',
    fontSize: 14,
  },
  collapseToggle: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  collapseToggleError: {
    borderColor: colors.danger,
  },
  collapseToggleText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  collapseToggleTextError: {
    color: colors.dangerText,
  },
  poiPickerBox: {
    marginTop: 8,
    marginBottom: 4,
  },
  poiPager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 8,
  },
  pagerBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.chip,
  },
  pagerBtnDisabled: {
    opacity: 0.4,
  },
  pagerBtnText: {
    color: colors.chipText,
    fontWeight: '700',
    fontSize: 13,
  },
  pagerMeta: {
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 13,
  },
  footerBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
    marginBottom: 20,
  },
  backButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  backButtonText: {
    color: colors.chipText,
    fontWeight: '700',
  },
  submitButton: {
    flex: 2,
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 15,
  },
  errorText: {
    backgroundColor: colors.dangerSoft,
    color: colors.dangerText,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    fontSize: 13,
  },
  submitError: {
    marginTop: 12,
    backgroundColor: colors.dangerSoft,
    color: colors.dangerText,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
  },
});
