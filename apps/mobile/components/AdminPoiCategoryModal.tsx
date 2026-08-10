import { useMemo, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CategoryIcon } from './CategoryIcon';
import { ADMIN_POI_CATEGORIES, type GoogleMapPoiPayload } from '../lib/adminMap';
import { getCategoryLabel } from '../lib/categoryUtils';
import type { PoiCategory } from '../types/database';

import type { ThemeColors } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';

type Props = {
  visible: boolean;
  poi: GoogleMapPoiPayload | null;
  loading?: boolean;
  onCancel: () => void;
  /** Primary = categories[0]; may include hotel+restaurant etc. */
  onConfirm: (categories: PoiCategory[], name: string) => void;
};

export function AdminPoiCategoryModal({
  visible,
  poi,
  loading = false,
  onCancel,
  onConfirm,
}: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [categories, setCategories] = useState<PoiCategory[]>([]);
  const [name, setName] = useState('');

  useEffect(() => {
    if (visible && poi) {
      setName(poi.name?.trim() || '');
      setCategories(poi.suggestedCategory ? [poi.suggestedCategory] : []);
    }
  }, [visible, poi]);

  const canConfirm =
    Boolean(poi) && name.trim().length >= 2 && categories.length >= 1 && !loading;
  const suggested = poi?.suggestedCategory ?? null;

  function toggleCategory(item: PoiCategory) {
    setCategories((prev) => {
      if (prev.includes(item)) {
        if (prev.length === 1) {
          return prev;
        }
        return prev.filter((c) => c !== item);
      }
      return [...prev, item];
    });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Məkanı əlavə et</Text>
          {poi ? (
            <Text style={styles.coords}>
              {poi.latitude.toFixed(5)}, {poi.longitude.toFixed(5)}
            </Text>
          ) : null}

          {poi?.rating != null && poi.rating > 0 ? (
            <Text style={styles.ratingHint}>
              ★ {poi.rating.toFixed(1)}
              {poi.ratingCount != null && poi.ratingCount > 0
                ? ` · ${poi.ratingCount} rəy`
                : ''}
            </Text>
          ) : null}

          {suggested ? (
            <View style={styles.suggestRow}>
              <Text style={styles.suggestHint}>Təklif olunan kateqoriya:</Text>
              <CategoryIcon category={suggested} size={14} color={colors.accent} />
              <Text style={styles.suggestHint}>
                {getCategoryLabel(suggested)} — əlavə kateqoriya da seçə bilərsiniz
              </Text>
            </View>
          ) : (
            <Text style={styles.suggestHintMuted}>
              Bir və ya bir neçə kateqoriya seçin (məs: otel + restoran)
            </Text>
          )}

          <Text style={styles.label}>Ad</Text>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            placeholder="Məs: Qız Qalası"
            placeholderTextColor={colors.textMuted}
            editable={!loading}
            autoFocus
          />

          <Text style={styles.label}>
            Kateqoriyalar ({categories.length}) — çoxlu seçim
          </Text>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {ADMIN_POI_CATEGORIES.map((item) => {
              const selected = categories.includes(item);
              return (
                <Pressable
                  key={item}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => toggleCategory(item)}
                  disabled={loading}
                >
                  <CategoryIcon
                    category={item}
                    size={16}
                    color={selected ? colors.accent : colors.text}
                  />
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {getCategoryLabel(item)}
                  </Text>
                  <Text style={[styles.check, selected && styles.checkOn]}>
                    {selected ? '✓' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable style={styles.cancelBtn} onPress={onCancel} disabled={loading}>
              <Text style={styles.cancelText}>Ləğv et</Text>
            </Pressable>
            <Pressable
              style={[styles.okBtn, !canConfirm && styles.okDisabled]}
              onPress={() => categories.length > 0 && onConfirm(categories, name.trim())}
              disabled={!canConfirm}
            >
              {loading ? (
                <ActivityIndicator color={colors.textOnAccent} />
              ) : (
                <Text style={styles.okText}>Əlavə et</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: colors.bg,
    borderRadius: 16,
    padding: 16,
    maxHeight: '88%',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  coords: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textMuted,
  },
  ratingHint: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
    color: colors.chipText,
  },
  suggestRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  suggestHint: {
    fontSize: 12,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  suggestHintMuted: {
    marginTop: 8,
    fontSize: 12,
    color: colors.textMuted,
  },
  label: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: '600',
    color: colors.chipText,
  },
  nameInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
  },
  list: {
    maxHeight: 280,
  },
  listContent: {
    gap: 4,
    paddingBottom: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  optionSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  optionText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  optionTextSelected: {
    color: colors.accent,
    fontWeight: '700',
  },
  check: {
    width: 18,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '700',
    color: colors.textMuted,
  },
  checkOn: {
    color: colors.accent,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  okBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  okDisabled: {
    opacity: 0.5,
  },
  okText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textOnAccent,
  },
});
}
