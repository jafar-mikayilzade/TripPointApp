import { useEffect, useState } from 'react';
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

import { ADMIN_POI_CATEGORIES, type GoogleMapPoiPayload } from '../lib/adminMap';
import { getCategoryEmoji, getCategoryLabel } from '../lib/categoryUtils';
import type { PoiCategory } from '../types/database';

import { colors } from '../constants/theme';

type Props = {
  visible: boolean;
  poi: GoogleMapPoiPayload | null;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (category: PoiCategory, name: string) => void;
};

export function AdminPoiCategoryModal({
  visible,
  poi,
  loading = false,
  onCancel,
  onConfirm,
}: Props) {
  const [category, setCategory] = useState<PoiCategory>('restaurant');
  const [name, setName] = useState('');

  useEffect(() => {
    if (visible && poi) {
      setName(poi.name?.trim() || '');
      setCategory('restaurant');
    }
  }, [visible, poi]);

  const canConfirm = Boolean(poi) && name.trim().length >= 2 && !loading;

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

          <Text style={styles.label}>Kateqoriya seçin</Text>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {ADMIN_POI_CATEGORIES.map((item) => {
              const selected = item === category;
              return (
                <Pressable
                  key={item}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => setCategory(item)}
                  disabled={loading}
                >
                  <Text style={styles.optionEmoji}>{getCategoryEmoji(item)}</Text>
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {getCategoryLabel(item)}
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
              style={[styles.confirmBtn, !canConfirm && styles.disabled]}
              onPress={() => onConfirm(category, name.trim())}
              disabled={!canConfirm}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.confirmText}>Təsdiq et</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    borderRadius: 16,
    padding: 16,
    maxHeight: '85%',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  coords: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textMuted,
  },
  label: {
    marginTop: 16,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
  },
  list: {
    maxHeight: 240,
  },
  listContent: {
    gap: 6,
    paddingBottom: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  optionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  optionEmoji: {
    fontSize: 16,
  },
  optionText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.chipText,
  },
  optionTextSelected: {
    color: colors.accentPressed,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelText: {
    fontWeight: '700',
    color: colors.textSecondary,
  },
  confirmBtn: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.accent,
    paddingVertical: 12,
    alignItems: 'center',
  },
  confirmText: {
    fontWeight: '700',
    color: colors.textOnAccent,
  },
  disabled: {
    opacity: 0.65,
  },
});
