import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DEFAULT_REGION_ID, REGIONS } from '../../constants/regions';
import { getCategoryEmoji } from '../../lib/categoryUtils';
import { supabase } from '../../lib/supabase';

import { colors } from '../../constants/theme';

type DayOption = 1 | 2 | 3 | 4;
type BudgetOption = 'budget' | 'mid' | 'premium';
type InterestId = 'nature' | 'history' | 'food' | 'family' | 'active' | 'photo';
type GroupOption = 'solo' | 'couple' | 'family' | 'group';

type PlanStop = {
  time: string;
  poi_id: string;
  name: string;
  category: string;
  duration: string;
  lat: number;
  lng: number;
  tip: string;
};

type PlanDay = {
  day: number;
  title: string;
  stops: PlanStop[];
  estimated_cost?: string;
  notes?: string;
};

type GeneratedPlan = {
  summary: string;
  days: PlanDay[];
  total_cost?: string;
  best_time?: string;
  regionLabel: string;
  daysCount: number;
  budgetLabel: string;
  interestLabels: string[];
  groupLabel: string | null;
};

const DAY_OPTIONS: { value: DayOption; label: string }[] = [
  { value: 1, label: '1 gün' },
  { value: 2, label: '2 gün' },
  { value: 3, label: '3 gün' },
  { value: 4, label: '4+ gün' },
];

const BUDGET_OPTIONS: { value: BudgetOption; label: string }[] = [
  { value: 'budget', label: 'Qənaətcil (0-50₼)' },
  { value: 'mid', label: 'Orta (50-150₼)' },
  { value: 'premium', label: 'Premium (150₼+)' },
];

const INTEREST_OPTIONS: { id: InterestId; label: string }[] = [
  { id: 'nature', label: '🌿 Təbiət' },
  { id: 'history', label: '🏛 Tarix' },
  { id: 'food', label: '🍽 Qastronomiya' },
  { id: 'family', label: '👨‍👩‍👧 Ailəvi' },
  { id: 'active', label: '🏃 Aktiv' },
  { id: 'photo', label: '📸 Fotoqrafiya' },
];

const GROUP_OPTIONS: { value: GroupOption; label: string }[] = [
  { value: 'solo', label: 'Tək' },
  { value: 'couple', label: '2 nəfər' },
  { value: 'family', label: 'Ailə' },
  { value: 'group', label: 'Qrup' },
];

export default function MarsrutScreen() {
  const insets = useSafeAreaInsets();

  const [regionId, setRegionId] = useState(DEFAULT_REGION_ID);
  const [days, setDays] = useState<DayOption>(2);
  const [budget, setBudget] = useState<BudgetOption>('mid');
  const [interests, setInterests] = useState<InterestId[]>(['nature']);
  const [group, setGroup] = useState<GroupOption | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);

  const canSubmit = useMemo(
    () => Boolean(regionId && days && budget && interests.length > 0),
    [regionId, days, budget, interests]
  );

  function toggleInterest(id: InterestId) {
    setInterests((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  const planRoute = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);

      if (!regionId) {
        setErrorMessage('Region seçin.');
        return;
      }
      if (!days) {
        setErrorMessage('Gün sayını seçin.');
        return;
      }
      if (!budget) {
        setErrorMessage('Büdcə seçin.');
        return;
      }
      if (interests.length === 0) {
        setErrorMessage('Ən azı bir maraq seçin.');
        return;
      }

      // 1. Real POI-ləri Supabase-dən al
      const { data: pois, error: poisError } = await supabase
        .from('pois')
        .select('id, name, category, description, lat, lng, region')
        .eq('status', 'approved')
        .eq('region', regionId.toLowerCase())
        .limit(30);

      if (poisError) {
        throw poisError;
      }

      if (!pois || pois.length === 0) {
        setErrorMessage(
          'Bu bölgədə hələ yer əlavə edilməyib. Başqa rayon seçin.'
        );
        return;
      }

      // 2. POI-ləri kateqoriyaya görə qruplaşdır
      const restaurants = pois.filter((p) =>
        ['restaurant', 'home_restaurant'].includes(p.category)
      );
      const accommodations = pois.filter((p) =>
        ['hotel', 'hostel', 'guesthouse'].includes(p.category)
      );
      const attractions = pois.filter((p) =>
        [
          'nature',
          'waterfall',
          'mountain',
          'lake',
          'historical',
          'monument',
          'other',
        ].includes(p.category)
      );

      // 3. OpenAI-a göndər
      const response = await supabase.functions.invoke('plan-route', {
        body: {
          region: regionId,
          days,
          budget,
          interests,
          groupType: group ?? 'solo',
          pois: {
            restaurants,
            accommodations,
            attractions,
          },
        },
      });

      if (response.error) {
        throw response.error;
      }

      const data = response.data as {
        summary?: string;
        days?: PlanDay[];
        total_cost?: string;
        best_time?: string;
        error?: string;
      };

      if (data?.error) {
        throw new Error(data.error);
      }

      if (!data?.days || !Array.isArray(data.days)) {
        throw new Error('Marşrut cavabı gözlənilən formatda deyil.');
      }

      const regionLabel = REGIONS.find((r) => r.id === regionId)?.label ?? regionId;
      const budgetLabel = BUDGET_OPTIONS.find((b) => b.value === budget)?.label ?? budget;
      const interestLabels = INTEREST_OPTIONS.filter((i) => interests.includes(i.id)).map(
        (i) => i.label
      );
      const groupLabel = group
        ? (GROUP_OPTIONS.find((g) => g.value === group)?.label ?? null)
        : null;

      setPlan({
        summary: data.summary ?? `${regionLabel} üçün marşrut hazırlandı.`,
        days: data.days.map((day) => ({
          ...day,
          stops: Array.isArray(day.stops) ? day.stops : [],
        })),
        total_cost: data.total_cost,
        best_time: data.best_time,
        regionLabel,
        daysCount: days,
        budgetLabel,
        interestLabels,
        groupLabel,
      });
    } catch (err: any) {
      const errMsg =
        err?.message || err?.error?.message || JSON.stringify(err) || 'Naməlum xəta';
      console.log('PLAN ROUTE XƏTA:', errMsg);
      setErrorMessage('Debug: ' + errMsg);
    } finally {
      setLoading(false);
    }
  };

  function handleReset() {
    setPlan(null);
    setErrorMessage(null);
  }

  if (plan) {
    return (
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.resultContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>Marşrutunuz hazırdır</Text>
            <Text style={styles.subtitle}>{plan.summary}</Text>

            <View style={styles.summaryCard}>
              <SummaryRow label="Region" value={plan.regionLabel} />
              <SummaryRow label="Müddət" value={`${plan.daysCount} gün`} />
              <SummaryRow label="Büdcə" value={plan.budgetLabel} />
              {plan.groupLabel ? <SummaryRow label="Qrup" value={plan.groupLabel} /> : null}
              <SummaryRow label="Maraqlar" value={plan.interestLabels.join(' · ')} />
              {plan.total_cost ? (
                <SummaryRow label="Ümumi xərc" value={plan.total_cost} />
              ) : null}
              {plan.best_time ? (
                <SummaryRow label="Ən yaxşı vaxt" value={plan.best_time} />
              ) : null}
            </View>

            {plan.days.map((day) => (
              <View key={day.day} style={styles.dayCard}>
                <Text style={styles.dayTitle}>{day.title}</Text>
                {day.estimated_cost ? (
                  <Text style={styles.dayMeta}>💰 {day.estimated_cost}</Text>
                ) : null}
                {day.notes ? <Text style={styles.dayNotes}>{day.notes}</Text> : null}

                {day.stops.map((stop, index) => (
                  <View
                    key={`${stop.poi_id}-${index}`}
                    style={styles.stopRow}
                  >
                    <View style={styles.stopTimeCol}>
                      <Text style={styles.stopTime}>{stop.time}</Text>
                      <View style={styles.stopTimeline} />
                    </View>

                    <View style={styles.stopBody}>
                      <View style={styles.stopTitleRow}>
                        <Text style={styles.stopEmoji}>
                          {getCategoryEmoji(stop.category)}
                        </Text>
                        <Text style={styles.stopName}>{stop.name}</Text>
                      </View>
                      <Text style={styles.stopDuration}>⏱ {stop.duration}</Text>
                      {stop.tip ? (
                        <Text style={styles.stopTip}>💡 {stop.tip}</Text>
                      ) : null}
                      <TouchableOpacity
                        onPress={() =>
                          Linking.openURL(
                            `https://maps.google.com/?q=${stop.lat},${stop.lng}`
                          )
                        }
                        style={styles.mapsLink}
                      >
                        <Text style={styles.mapsLinkText}>🗺️ Xəritədə aç</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            ))}

            <Pressable style={styles.secondaryButton} onPress={handleReset}>
              <Text style={styles.secondaryButtonText}>Yeni marşrut hazırla</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.formContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>AI Marşrut Planlayıcı</Text>
          <Text style={styles.subtitle}>Sizin üçün ən optimal marşrutu hazırlayırıq</Text>

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          <Text style={styles.label}>
            Region <Text style={styles.required}>*</Text>
          </Text>
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
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {region.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.label}>
            Gün sayı <Text style={styles.required}>*</Text>
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {DAY_OPTIONS.map((option) => {
              const selected = option.value === days;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setDays(option.value)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.label}>
            Büdcə <Text style={styles.required}>*</Text>
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {BUDGET_OPTIONS.map((option) => {
              const selected = option.value === budget;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setBudget(option.value)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.label}>
            Maraqlar <Text style={styles.required}>*</Text>
          </Text>
          <View style={styles.interestGrid}>
            {INTEREST_OPTIONS.map((option) => {
              const selected = interests.includes(option.id);
              return (
                <Pressable
                  key={option.id}
                  onPress={() => toggleInterest(option.id)}
                  style={[styles.interestChip, selected && styles.interestChipSelected]}
                >
                  <Text style={[styles.interestText, selected && styles.interestTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Neçə nəfər (istəyə bağlı)</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {GROUP_OPTIONS.map((option) => {
              const selected = option.value === group;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setGroup(selected ? null : option.value)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            style={[styles.primaryButton, (!canSubmit || loading) && styles.primaryButtonDisabled]}
            onPress={planRoute}
            disabled={!canSubmit || loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Marşrut Hazırla</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  formContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    flexGrow: 1,
  },
  resultContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    flexGrow: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    marginTop: 8,
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 18,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.chipText,
    marginBottom: 8,
    marginTop: 8,
  },
  required: {
    color: colors.danger,
  },
  chipRow: {
    paddingBottom: 8,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: colors.chip,
    marginRight: 8,
    overflow: 'hidden',
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
  interestGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  interestChip: {
    width: '48%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 14,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  interestChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  interestText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.chipText,
    textAlign: 'center',
    flexShrink: 1,
  },
  interestTextSelected: {
    color: colors.accentPressed,
  },
  primaryButton: {
    marginTop: 24,
    marginBottom: 20,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    overflow: 'hidden',
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: colors.textOnAccent,
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    marginTop: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    overflow: 'hidden',
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  errorText: {
    backgroundColor: colors.dangerSoft,
    color: colors.dangerText,
    borderRadius: 16,
    padding: 10,
    marginBottom: 8,
    fontSize: 13,
    overflow: 'hidden',
  },
  summaryCard: {
    borderRadius: 24,
    padding: 14,
    marginBottom: 16,
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    gap: 8,
    overflow: 'hidden',
  },
  summaryRow: {
    gap: 2,
  },
  summaryLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  summaryValue: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
    flexShrink: 1,
  },
  dayCard: {
    borderRadius: 24,
    padding: 14,
    marginBottom: 12,
    overflow: 'hidden',
  },
  dayTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
    flexShrink: 1,
  },
  dayMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  dayNotes: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 10,
    fontStyle: 'italic',
    flexShrink: 1,
  },
  stopRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.chip,
  },
  stopTimeCol: {
    width: 50,
    alignItems: 'center',
  },
  stopTime: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  stopTimeline: {
    width: 2,
    flex: 1,
    backgroundColor: colors.border,
    marginTop: 4,
  },
  stopBody: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    paddingLeft: 12,
  },
  stopTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stopEmoji: {
    fontSize: 16,
  },
  stopName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  stopDuration: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  stopTip: {
    fontSize: 13,
    color: colors.chipText,
    marginTop: 4,
    fontStyle: 'italic',
    flexShrink: 1,
  },
  mapsLink: {
    marginTop: 6,
  },
  mapsLinkText: {
    fontSize: 12,
    color: colors.accent,
  },
});
