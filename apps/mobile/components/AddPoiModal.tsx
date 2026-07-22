import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import MapView, { Marker, type MapPressEvent } from './AppMap';

import { DEFAULT_REGION_ID, REGIONS } from '../constants/regions';
import { getErrorMessage } from '../lib/errors';
import {
  TEXT_FORMAT_ERROR,
  formatAzPhoneE164,
  hasDisallowedTextSymbols,
  sanitizeFreeTextWordPatterns,
  sanitizeLettersOnlyInput,
  validateAzPhone,
  validateLettersOnlyField,
  validateTextWordPatterns,
} from '../lib/formValidation';
import { notifyAdminsViaWhatsApp } from '../lib/adminNotify';
import { parseCoordsFromGoogleMapsUrl, POI_CATEGORY_OPTIONS } from '../lib/poi';
import { supabase } from '../lib/supabase';
import { uploadImage } from '../lib/uploadImage';
import type { PoiCategory } from '../types/database';
import { PhoneField } from './PhoneField';
import { CategoryIcon } from './CategoryIcon';

import { colors } from '../constants/theme';

interface AddPoiModalProps {
  visible: boolean;
  onClose: () => void;
  initialRegionId?: string;
}

type CoordTab = 'map' | 'link';

const STORAGE_BUCKET = 'poi-photos';
const MAX_IMAGES = 3;

export function AddPoiModal({ visible, onClose, initialRegionId }: AddPoiModalProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<PoiCategory>('restaurant');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [regionId, setRegionId] = useState(initialRegionId ?? DEFAULT_REGION_ID);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [mapsLink, setMapsLink] = useState('');
  const [coordTab, setCoordTab] = useState<CoordTab>('map');
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const selectedRegion = useMemo(
    () => REGIONS.find((r) => r.id === regionId) ?? REGIONS[0],
    [regionId]
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    setName('');
    setCategory('restaurant');
    setDescription('');
    setPhone('');
    setRegionId(initialRegionId ?? DEFAULT_REGION_ID);
    setLat(null);
    setLng(null);
    setMapsLink('');
    setCoordTab('map');
    setImageUris([]);
    setLoading(false);
    setErrorMessage(null);
    setNameError(null);
    setPhoneError(null);
  }, [visible, initialRegionId]);

  function handleMapPress(event: MapPressEvent) {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    setLat(latitude);
    setLng(longitude);
  }

  function handleParseMapsLink() {
    setErrorMessage(null);
    const coords = parseCoordsFromGoogleMapsUrl(mapsLink);

    if (!coords) {
      setErrorMessage('Linkdən koordinat tapılmadı. @lat,lng və ya ?q=lat,lng formatını yoxlayın.');
      return;
    }

    setLat(coords.lat);
    setLng(coords.lng);
  }

  async function handlePickImages() {
    setErrorMessage(null);

    if (imageUris.length >= MAX_IMAGES) {
      setErrorMessage(`Maksimum ${MAX_IMAGES} şəkil əlavə edilə bilər.`);
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setErrorMessage('Şəkil seçmək üçün qalereya icazəsi lazımdır.');
      return;
    }

    const remaining = MAX_IMAGES - imageUris.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });

    if (!result.canceled && result.assets.length > 0) {
      const next = [...imageUris, ...result.assets.map((asset) => asset.uri)].slice(0, MAX_IMAGES);
      setImageUris(next);
    }
  }

  function removeImage(uri: string) {
    setImageUris((current) => current.filter((item) => item !== uri));
  }

  async function handleSubmit() {
    setErrorMessage(null);

    const nameValidation = validateLettersOnlyField(name, 'Ad');
    if (nameValidation) {
      setNameError(nameValidation);
      setErrorMessage(nameValidation);
      return;
    }

    if (lat === null || lng === null) {
      setErrorMessage('Koordinat seçin (xəritə və ya Google Maps linki).');
      return;
    }

    const phoneValidation = validateAzPhone(phone, false);
    if (phoneValidation) {
      setPhoneError(phoneValidation);
      setErrorMessage(phoneValidation);
      if (phone.trim()) {
        setPhone('');
      }
      return;
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

      const { data: poi, error: insertError } = await supabase
        .from('pois')
        .insert({
          name: name.trim(),
          category,
          description: description.trim() || null,
          phone: formatAzPhoneE164(phone) || null,
          region: regionId,
          lat,
          lng,
          submitted_by: user.id,
          status: 'pending',
        })
        .select('id')
        .single();

      if (insertError || !poi) {
        setErrorMessage(insertError ? getErrorMessage(insertError) : 'POI göndərilmədi.');
        return;
      }

      if (imageUris.length > 0) {
        const uploadedUrls: string[] = [];

        for (let i = 0; i < imageUris.length; i += 1) {
          const extension = imageUris[i].split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'jpg';
          const safeExt =
            extension === 'png' || extension === 'webp' || extension === 'jpeg' || extension === 'jpg'
              ? extension
              : 'jpg';
          const path = `${user.id}/${poi.id}-${i}.${safeExt}`;
          const publicUrl = await uploadImage(imageUris[i], STORAGE_BUCKET, path);
          uploadedUrls.push(publicUrl);
        }

        const photoRows = uploadedUrls.map((photoUrl, index) => ({
          poi_id: poi.id,
          photo_url: photoUrl,
          order_index: index,
          status: 'pending' as const,
          uploaded_by: user.id,
        }));

        const { error: photoError } = await supabase.from('poi_photos').insert(photoRows);
        if (photoError) {
          setErrorMessage(`Yer göndərildi, amma şəkillər yüklənmədi: ${getErrorMessage(photoError)}`);
          Alert.alert(
            'Qismən uğurlu',
            'Yeriniz göndərildi və admin təsdiqinə göndərildi. Şəkillər yüklənmədi.'
          );
          onClose();
          return;
        }
      }

      Alert.alert(
        'Təsdiq gözlənilir',
        'Yeriniz və şəkilləriniz admin təsdiqinə göndərildi. Təsdiqdən sonra xəritədə görünəcək.',
        [
          {
            text: 'OK',
            onPress: () => {
              onClose();
              void notifyAdminsViaWhatsApp(
                'poi_pending',
                `"${name.trim()}" — region: ${regionId}`
              );
            },
          },
        ]
      );
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
            <Text style={styles.title}>Yeni yer əlavə et</Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton}>
              <FontAwesome name="times" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.form}
          >
            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

            <Text style={styles.label}>
              Ad <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={[styles.input, nameError ? styles.inputError : null]}
              value={name}
              onChangeText={(text) => {
                const lettersOnly = text.replace(/[^\p{L}\s]/gu, '');
                const cleaned = sanitizeLettersOnlyInput(text);
                if (hasDisallowedTextSymbols(text)) {
                  setNameError(TEXT_FORMAT_ERROR);
                } else if (cleaned.length < lettersOnly.length) {
                  setNameError(validateTextWordPatterns(lettersOnly) ?? TEXT_FORMAT_ERROR);
                } else {
                  setNameError(null);
                }
                setName(cleaned);
              }}
              onBlur={() => setNameError(validateLettersOnlyField(name, 'Ad'))}
              placeholder="Yerin adı"
              placeholderTextColor={colors.textMuted}
              editable={!loading}
            />
            {nameError ? <Text style={styles.fieldHintError}>{nameError}</Text> : null}

            <Text style={styles.label}>Kateqoriya</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {POI_CATEGORY_OPTIONS.map((option) => {
                const selected = option.value === category;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setCategory(option.value)}
                    disabled={loading}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <CategoryIcon
                      category={option.value}
                      size={13}
                      color={selected ? colors.textOnAccent : colors.text}
                    />
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={styles.label}>Region</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {REGIONS.map((region) => {
                const selected = region.id === regionId;
                return (
                  <Pressable
                    key={region.id}
                    onPress={() => setRegionId(region.id)}
                    disabled={loading}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {region.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={styles.label}>Təsvir</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={(text) => setDescription(sanitizeFreeTextWordPatterns(text))}
              placeholder="Qısa təsvir..."
              placeholderTextColor={colors.textMuted}
              multiline
              textAlignVertical="top"
              editable={!loading}
            />

            <PhoneField
              label="Telefon (istəyə bağlı)"
              value={phone}
              onChangeLocal={setPhone}
              error={phoneError}
              onValidationError={setPhoneError}
              editable={!loading}
            />

            <Text style={styles.label}>
              Koordinat <Text style={styles.required}>*</Text>
            </Text>
            <View style={styles.tabRow}>
              <Pressable
                style={[styles.tab, coordTab === 'map' && styles.tabActive]}
                onPress={() => setCoordTab('map')}
                disabled={loading}
              >
                <Text style={[styles.tabText, coordTab === 'map' && styles.tabTextActive]}>
                  Xəritədən seç
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tab, coordTab === 'link' && styles.tabActive]}
                onPress={() => setCoordTab('link')}
                disabled={loading}
              >
                <Text style={[styles.tabText, coordTab === 'link' && styles.tabTextActive]}>
                  Link yapışdır
                </Text>
              </Pressable>
            </View>

            {coordTab === 'map' ? (
              <View style={styles.miniMapWrap}>
                <MapView
                  style={styles.miniMap}
                  initialRegion={{
                    latitude: lat ?? selectedRegion.latitude,
                    longitude: lng ?? selectedRegion.longitude,
                    latitudeDelta: 0.08,
                    longitudeDelta: 0.08,
                  }}
                  onPress={handleMapPress}
                >
                  {lat !== null && lng !== null ? (
                    <Marker coordinate={{ latitude: lat, longitude: lng }} />
                  ) : null}
                </MapView>
                <Text style={styles.hint}>Xəritəyə toxunaraq pin qoyun</Text>
              </View>
            ) : (
              <View style={styles.linkBlock}>
                <TextInput
                  style={styles.input}
                  value={mapsLink}
                  onChangeText={setMapsLink}
                  placeholder="https://maps.google.com/..."
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                />
                <Pressable style={styles.parseButton} onPress={handleParseMapsLink} disabled={loading}>
                  <Text style={styles.parseButtonText}>Koordinatı çıxar</Text>
                </Pressable>
              </View>
            )}

            {lat !== null && lng !== null ? (
              <Text style={styles.coordsPreview}>
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </Text>
            ) : null}

            <Text style={styles.label}>Şəkil əlavə et (max {MAX_IMAGES})</Text>
            <Text style={styles.hint}>Şəkillər admin təsdiqindən sonra görünəcək</Text>
            <View style={styles.imagesRow}>
              {imageUris.map((uri) => (
                <View key={uri} style={styles.imageThumbWrap}>
                  <Image source={{ uri }} style={styles.imageThumb} />
                  <Pressable style={styles.removeImage} onPress={() => removeImage(uri)}>
                    <FontAwesome name="times" size={12} color="#fff" />
                  </Pressable>
                </View>
              ))}
              {imageUris.length < MAX_IMAGES ? (
                <Pressable style={styles.imagePicker} onPress={handlePickImages} disabled={loading}>
                  <FontAwesome name="camera" size={20} color={colors.textMuted} />
                  <Text style={styles.imagePickerText}>Əlavə et</Text>
                </Pressable>
              ) : null}
            </View>

            <Pressable
              style={[styles.submitButton, loading && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>Göndər</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  closeButton: {
    padding: 8,
  },
  form: {
    paddingHorizontal: 20,
    paddingBottom: 80,
    flexGrow: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.chipText,
    marginBottom: 6,
    marginTop: 12,
  },
  required: {
    color: colors.danger,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputError: {
    borderColor: colors.danger,
  },
  fieldHintError: {
    marginTop: 6,
    marginBottom: 4,
    fontSize: 12,
    color: colors.danger,
    lineHeight: 16,
  },
  textArea: {
    minHeight: 88,
  },
  chipRow: {
    gap: 8,
    paddingVertical: 2,
    paddingHorizontal: 16,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    marginRight: 6,
  },
  chipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.chipText,
  },
  chipTextSelected: {
    color: colors.textOnAccent,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: colors.chip,
    borderRadius: 10,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.surface,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.accent,
  },
  miniMapWrap: {
    marginTop: 10,
  },
  miniMap: {
    height: 180,
    borderRadius: 10,
    overflow: 'hidden',
  },
  hint: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textSecondary,
  },
  linkBlock: {
    marginTop: 10,
    gap: 8,
  },
  parseButton: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  parseButtonText: {
    color: colors.textOnAccent,
    fontWeight: '600',
    fontSize: 13,
  },
  coordsPreview: {
    marginTop: 8,
    fontSize: 13,
    color: colors.accent,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  imagesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  imageThumbWrap: {
    width: 84,
    height: 84,
    borderRadius: 10,
    overflow: 'hidden',
  },
  imageThumb: {
    width: '100%',
    height: '100%',
  },
  removeImage: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePicker: {
    width: 84,
    height: 84,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  imagePickerText: {
    marginTop: 6,
    fontSize: 11,
    color: colors.textSecondary,
  },
  submitButton: {
    marginTop: 20,
    marginBottom: 20,
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: colors.textOnAccent,
    fontSize: 15,
    fontWeight: '600',
  },
  errorText: {
    color: colors.dangerText,
    fontSize: 13,
    backgroundColor: colors.dangerSoft,
    borderRadius: 8,
    padding: 10,
    marginBottom: 4,
  },
});
