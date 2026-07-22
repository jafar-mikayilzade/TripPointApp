import { useMemo } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { REGIONS } from '../constants/regions';
import { colors } from '../constants/theme';
import { openStopInMaps } from '../lib/listingRouteStops';
import type { SavedRoute } from '../lib/savedRoutes';

type Props = {
  route: SavedRoute | null;
  visible: boolean;
  onClose: () => void;
  onUnsave: () => void;
  onShareAsTour?: () => void;
};

export function SavedRouteDetailModal({
  route,
  visible,
  onClose,
  onUnsave,
  onShareAsTour,
}: Props) {
  const insets = useSafeAreaInsets();
  const bottomSafe = Math.max(insets.bottom, 12);

  const regionLabel = useMemo(() => {
    if (!route?.region) {
      return '—';
    }
    return REGIONS.find((r) => r.id === route.region)?.label ?? route.region;
  }, [route?.region]);

  if (!route) {
    return null;
  }

  const sourceLabel = route.source === 'ai' ? 'AI marşrut' : 'Əl ilə';
  const alreadyShared = !!route.listing_id;
  const stops = route.stops ?? [];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: bottomSafe }]}>
          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerTitle} numberOfLines={2}>
                {route.title}
              </Text>
              <Text style={styles.headerSubtitle}>
                {sourceLabel} · {regionLabel}
                {route.days_count > 1 ? ` · ${route.days_count} gün` : ''}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.closeText}>Bağla</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {route.summary ? (
              <Text style={styles.summary}>{route.summary}</Text>
            ) : null}

            {alreadyShared ? (
              <Text style={styles.sharedBadge}>Tur kimi paylaşılıb</Text>
            ) : null}

            <Text style={styles.sectionLabel}>Marşrut ({stops.length})</Text>
            {stops.length === 0 ? (
              <Text style={styles.muted}>Nöqtə yoxdur</Text>
            ) : (
              stops.map((stop, index) => (
                <Pressable
                  key={`${stop.name}-${index}`}
                  style={styles.stopRow}
                  onPress={() =>
                    void openStopInMaps({
                      name: stop.name,
                      lat: stop.lat,
                      lng: stop.lng,
                      poi_id: stop.poi_id,
                    })
                  }
                >
                  <Text style={styles.stopIndex}>{index + 1}</Text>
                  <View style={styles.stopBody}>
                    <Text style={styles.stopName}>{stop.name}</Text>
                    {stop.time || stop.duration ? (
                      <Text style={styles.stopMeta}>
                        {[stop.time, stop.duration].filter(Boolean).join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.mapsHint}>Maps</Text>
                </Pressable>
              ))
            )}
          </ScrollView>

          <View style={styles.footer}>
            {!alreadyShared && onShareAsTour && route.source === 'manual' ? (
              <Pressable style={styles.tourBtn} onPress={onShareAsTour}>
                <Text style={styles.tourBtnText}>Tur kimi paylaş</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.unsaveBtn} onPress={onUnsave}>
              <Text style={styles.unsaveBtnText}>Yadda saxlanandan çıxar</Text>
            </Pressable>
          </View>
        </View>
      </View>
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
    maxHeight: '88%',
    minHeight: '55%',
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
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
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
  },
  summary: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: 10,
  },
  sharedBadge: {
    alignSelf: 'flex-start',
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.successSoft,
    color: colors.success,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  muted: {
    fontSize: 13,
    color: colors.textMuted,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  stopIndex: {
    width: 22,
    height: 22,
    borderRadius: 8,
    textAlign: 'center',
    textAlignVertical: 'center',
    overflow: 'hidden',
    backgroundColor: colors.chip,
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 22,
  },
  stopBody: {
    flex: 1,
    minWidth: 0,
  },
  stopName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  stopMeta: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
  },
  mapsHint: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accent,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSoft,
  },
  tourBtn: {
    backgroundColor: colors.success,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  tourBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  unsaveBtn: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  unsaveBtnText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 14,
  },
});
