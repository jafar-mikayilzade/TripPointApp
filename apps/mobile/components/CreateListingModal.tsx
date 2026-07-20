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
  buildCarpoolTitle,
  formatAzPhoneE164,
  sanitizeLettersOnlyInput,
  validateAzPhone,
  validateLettersOnlyField,
} from '../lib/formValidation';
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
  const [departureAt, setDepartureAt] = useState(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const [capacity, setCapacity] = useState(3);
  const [price, setPrice] = useState('');
  const [isFree, setIsFree] = useState(false);
  const [contactPhone, setContactPhone] = useState('');
  const [regionId, setRegionId] = useState(DEFAULT_REGION_ID);
  const [description, setDescription] = useState('');
  const [selectedPoiIds, setSelectedPoiIds] = useState<string[]>([]);
  const [approvedPois, setApprovedPois] = useState<Poi[]>([]);
  const [loadingPois, setLoadingPois] = useState(false);
  const [poiPickerOpen, setPoiPickerOpen] = useState(false);
  const [poiPage, setPoiPage] = useState(0);
  const [serviceCategory, setServiceCategory] = useState<LocalServiceCategory>('private_guide');
  const [priceType, setPriceType] = useState<ListingPriceType>('per_person');
  const [isRecurring, setIsRecurring] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }

    setStep(1);
    setListingType(null);
    setTitle('');
    setOriginText('');
    setDestinationText('');
    setDepartureAt(new Date(Date.now() + 24 * 60 * 60 * 1000));
    setCapacity(3);
    setPrice('');
    setIsFree(false);
    setContactPhone('');
    setRegionId(DEFAULT_REGION_ID);
    setDescription('');
    setSelectedPoiIds([]);
    setPoiPickerOpen(false);
    setPoiPage(0);
    setServiceCategory('private_guide');
    setPriceType('per_person');
    setIsRecurring(false);
    setErrorMessage(null);
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
    if (!visible || listingType !== 'tour' || step !== 2 || !poiPickerOpen) {
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
        setErrorMessage(getErrorMessage(error));
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

  const poiTotalPages = Math.max(1, Math.ceil(approvedPois.length / POI_PAGE_SIZE));
  const pagedPois = useMemo(() => {
    const start = poiPage * POI_PAGE_SIZE;
    return approvedPois.slice(start, start + POI_PAGE_SIZE);
  }, [approvedPois, poiPage]);

  const parsedPrice = useMemo(() => {
    if (isFree || priceType === 'free') {
      return null;
    }
    const value = Number(price.replace(',', '.'));
    return Number.isFinite(value) ? value : null;
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

  function selectType(type: ListingType) {
    setListingType(type);
    setStep(2);
    setErrorMessage(null);
    if (type === 'tour') {
      setPriceType('per_person');
      setIsFree(false);
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

  async function handleSubmit() {
    if (!listingType) {
      setErrorMessage('Tip seçin.');
      return;
    }

    setErrorMessage(null);

    let resolvedTitle = title.trim();

    if (listingType === 'carpool') {
      const originError = validateLettersOnlyField(originText, 'Haradan');
      if (originError) {
        setErrorMessage(originError);
        return;
      }
      const destinationError = validateLettersOnlyField(destinationText, 'Haraya');
      if (destinationError) {
        setErrorMessage(destinationError);
        return;
      }
      resolvedTitle = buildCarpoolTitle(originText, destinationText);
      if (!resolvedTitle) {
        setErrorMessage('Haradan və Haraya sahələrini doldurun.');
        return;
      }
      if (!isFree && parsedPrice === null) {
        setErrorMessage('Qiymət daxil edin və ya Pulsuz seçin.');
        return;
      }
      const phoneError = validateAzPhone(contactPhone, true);
      if (phoneError) {
        setErrorMessage(phoneError);
        return;
      }
    }

    if (listingType === 'tour') {
      const titleError = validateLettersOnlyField(title, 'Başlıq');
      if (titleError) {
        setErrorMessage(titleError);
        return;
      }
      if (parsedPrice === null) {
        setErrorMessage('Qiymət daxil edin.');
        return;
      }
      if (capacity < 1) {
        setErrorMessage('Nəfər sayı ən azı 1 olmalıdır.');
        return;
      }
    }

    if (listingType === 'local_service') {
      const titleError = validateLettersOnlyField(title, 'Başlıq');
      if (titleError) {
        setErrorMessage(titleError);
        return;
      }
      if (priceType !== 'free' && priceType !== 'negotiable' && parsedPrice === null) {
        setErrorMessage('Qiymət daxil edin.');
        return;
      }
      const phoneError = validateAzPhone(contactPhone, true);
      if (phoneError) {
        setErrorMessage(phoneError);
        return;
      }
    }

    setLoading(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setErrorMessage(userError ? getErrorMessage(userError) : 'Daxil olmaq lazımdır.');
        return;
      }

      const capacityValue = listingType === 'local_service' ? null : capacity;
      const { price: priceValue, price_type: priceTypeValue } = resolvePriceFields();

      const formattedPhone = formatAzPhoneE164(contactPhone);

      const payload = {
        created_by: user.id,
        type: listingType,
        title: resolvedTitle,
        description: description.trim() || null,
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
        .single();

      if (insertError || !listing) {
        setErrorMessage(insertError ? getErrorMessage(insertError) : 'Elan yaradılmadı.');
        return;
      }

      if (listingType === 'tour' && selectedPoiIds.length > 0) {
        const rows = selectedPoiIds.map((poiId, index) => ({
          listing_id: listing.id,
          poi_id: poiId,
          sort_order: index + 1,
        }));

        const { error: poisError } = await supabase.from('listing_pois').insert(rows);
        if (poisError) {
          setErrorMessage(`Elan yaradıldı, amma marşrut yerləri yazılmadı: ${getErrorMessage(poisError)}`);
          onCreated();
          onClose();
          return;
        }
      }

      onCreated();
      onClose();
    } catch (err) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
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
            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

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
                  style={styles.input}
                  value={originText}
                  onChangeText={(text) => setOriginText(sanitizeLettersOnlyInput(text))}
                  placeholder="Bakı"
                  placeholderTextColor={colors.textMuted}
                />

                <FieldLabel text="Haraya" required />
                <TextInput
                  style={styles.input}
                  value={destinationText}
                  onChangeText={(text) => setDestinationText(sanitizeLettersOnlyInput(text))}
                  placeholder="Quba"
                  placeholderTextColor={colors.textMuted}
                />

                <FieldLabel text="Başlıq" required />
                <TextInput
                  style={[styles.input, styles.inputDisabled]}
                  value={title}
                  editable={false}
                  placeholder="Bakı Quba istiqamətində gedirəm"
                  placeholderTextColor={colors.textMuted}
                />

                <FieldLabel text="Tarix və saat" required />
                <SimpleDateTimeField value={departureAt} onChange={setDepartureAt} />

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
                  style={[styles.input, isFree && styles.inputDisabled]}
                  value={price}
                  onChangeText={setPrice}
                  placeholder="AZN"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  editable={!isFree}
                />
                <Pressable
                  style={styles.checkboxRow}
                  onPress={() => {
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
                  onChangeLocal={setContactPhone}
                />
              </>
            ) : null}

            {step === 2 && listingType === 'tour' ? (
              <>
                <FieldLabel text="Başlıq" required />
                <TextInput
                  style={styles.input}
                  value={title}
                  onChangeText={(text) => setTitle(sanitizeLettersOnlyInput(text))}
                  placeholder="Quba weekend turu"
                  placeholderTextColor={colors.textMuted}
                />

                <FieldLabel text="Region" required />
                <View style={styles.chipRowWrap}>
                  {REGIONS.map((region) => {
                    const selected = region.id === regionId;
                    return (
                      <Pressable
                        key={region.id}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setRegionId(region.id)}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {region.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <FieldLabel text="Tarix" required />
                <SimpleDateTimeField value={departureAt} onChange={setDepartureAt} />

                <FieldLabel text="Nəfər sayı" required />
                <TextInput
                  style={styles.input}
                  value={String(capacity)}
                  onChangeText={(text) => {
                    const next = Number(text.replace(/[^\d]/g, ''));
                    setCapacity(Number.isFinite(next) && next > 0 ? next : 1);
                  }}
                  keyboardType="number-pad"
                />

                <FieldLabel text="Qiymət / nəfər" required />
                <TextInput
                  style={styles.input}
                  value={price}
                  onChangeText={setPrice}
                  placeholder="AZN"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                />

                <FieldLabel text="Təsvir" />
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Tur haqqında..."
                  placeholderTextColor={colors.textMuted}
                  multiline
                  textAlignVertical="top"
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
              </>
            ) : null}

            {step === 2 && listingType === 'local_service' ? (
              <>
                <FieldLabel text="Başlıq" required />
                <TextInput
                  style={styles.input}
                  value={title}
                  onChangeText={(text) => setTitle(sanitizeLettersOnlyInput(text))}
                  placeholder="Offroad jeep turu"
                  placeholderTextColor={colors.textMuted}
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

                <FieldLabel text="Region" required />
                <View style={styles.chipRowWrap}>
                  {REGIONS.map((region) => {
                    const selected = region.id === regionId;
                    return (
                      <Pressable
                        key={region.id}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setRegionId(region.id)}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {region.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <FieldLabel text="Qiymət tipi" required />
                <View style={styles.chipRowWrap}>
                  {PRICE_TYPES.map((item) => {
                    const selected = priceType === item.value;
                    return (
                      <Pressable
                        key={item.value}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setPriceType(item.value)}
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
                      style={styles.input}
                      value={price}
                      onChangeText={setPrice}
                      placeholder="AZN"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="decimal-pad"
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

                <FieldLabel text="Ətraflı təsvir" />
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Xidmət haqqında..."
                  placeholderTextColor={colors.textMuted}
                  multiline
                  textAlignVertical="top"
                />

                <PhoneField
                  label="Əlaqə nömrəsi"
                  required
                  value={contactPhone}
                  onChangeLocal={setContactPhone}
                />
              </>
            ) : null}
          </ScrollView>

          {step === 2 ? (
            <View style={styles.footerBar}>
              <Pressable
                style={styles.backButton}
                onPress={() => {
                  setStep(1);
                  setErrorMessage(null);
                  setPoiPickerOpen(false);
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

function FieldLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <Text style={styles.label}>
      {text}
      {required ? <Text style={styles.required}> *</Text> : null}
    </Text>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
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
  inputDisabled: {
    backgroundColor: colors.chip,
    color: colors.textMuted,
  },
  textArea: {
    minHeight: 90,
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
    backgroundColor: colors.accent,
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
});
