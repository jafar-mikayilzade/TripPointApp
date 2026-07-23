import FontAwesome from '@expo/vector-icons/FontAwesome';
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
import { colors, radii, shadows } from '../constants/theme';
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
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{sourceLabel}</Text>
              </View>
              <Text style={styles.headerTitle} numberOfLines={2}>
                {route.title}
              </Text>
              <View style={styles.subtitleRow}>
                <Text style={styles.headerSubtitle}>
                  {regionLabel}
                  {route.days_count > 1 ? ` · ${route.days_count} gün` : ''}
                </Text>
                <View style={styles.stopsCluster}>
                  <Text style={styles.stopsCount}>{stops.length} nöqtə</Text>
                  <Pressable
                    onPress={onUnsave}
                    style={styles.bookmarkBtn}
                    hitSlop={8}
                    accessibilityLabel="Sevimlidən çıxar"
                  >
                    <FontAwesome name="bookmark" size={14} color={colors.favorite} />
                  </Pressable>
                </View>
              </View>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={12}>
              <FontAwesome name="times" size={16} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {route.summary ? (
              <View style={styles.summaryCard}>
                <Text style={styles.summary}>{route.summary}</Text>
              </View>
            ) : null}

            {alreadyShared ? (
              <View style={styles.sharedBadge}>
                <FontAwesome name="check-circle" size={12} color={colors.success} />
                <Text style={styles.sharedBadgeText}>Tur kimi paylaşılıb</Text>
              </View>
            ) : null}

            <Text style={styles.sectionLabel}>Marşrut</Text>
            {stops.length === 0 ? (
              <Text style={styles.muted}>Nöqtə yoxdur</Text>
            ) : (
              <View style={styles.stopsCard}>
                {stops.map((stop, index) => (
                  <Pressable
                    key={`${stop.name}-${index}`}
                    style={[
                      styles.stopRow,
                      index < stops.length - 1 && styles.stopRowBorder,
                    ]}
                    onPress={() =>
                      void openStopInMaps({
                        name: stop.name,
                        lat: stop.lat,
                        lng: stop.lng,
                        poi_id: stop.poi_id,
                      })
                    }
                  >
                    <View style={styles.stopIndex}>
                      <Text style={styles.stopIndexText}>{index + 1}</Text>
                    </View>
                    <View style={styles.stopBody}>
                      <Text style={styles.stopName}>{stop.name}</Text>
                      {stop.time || stop.duration ? (
                        <Text style={styles.stopMeta}>
                          {[stop.time, stop.duration].filter(Boolean).join(' · ')}
                        </Text>
                      ) : null}
                    </View>
                    <FontAwesome name="map-marker" size={14} color={colors.accent} />
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            {!alreadyShared && onShareAsTour && route.source === 'manual' ? (
              <Pressable style={styles.tourBtn} onPress={onShareAsTour}>
                <FontAwesome name="share-alt" size={13} color={colors.textOnAccent} />
                <Text style={styles.tourBtnText}>Tur kimi paylaş</Text>
              </Pressable>
            ) : null}
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
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '88%',
    minHeight: '52%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accentSoft,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accent,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  subtitleRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  stopsCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  stopsCount: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  bookmarkBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.favorite,
    backgroundColor: '#FFF3D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 20,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: 14,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    ...shadows.card,
  },
  summary: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  sharedBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.successSoft,
  },
  sharedBadgeText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '700',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  muted: {
    fontSize: 13,
    color: colors.textMuted,
  },
  stopsCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    overflow: 'hidden',
    ...shadows.card,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  stopRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  stopIndex: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopIndexText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.accent,
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
    fontSize: 12,
    color: colors.textMuted,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSoft,
  },
  tourBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.success,
    borderRadius: radii.md,
    paddingVertical: 14,
  },
  tourBtnText: {
    color: colors.textOnAccent,
    fontWeight: '700',
    fontSize: 15,
  },
});
