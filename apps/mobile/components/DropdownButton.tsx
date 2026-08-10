import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ThemeColors } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';

type Option = { label: string; value: string };

type Props = {
  label: string;
  value: string | null;
  options: Option[];
  onSelect: (value: string) => void;
  /** Always-visible caption above the value. */
  caption?: string;
  compact?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  style?: StyleProp<ViewStyle>;
};

/** Fixed trigger height — prevents sibling row jump when captions/values differ. */
const TRIGGER_H = 44;
const TRIGGER_H_COMPACT = 40;

export function DropdownButton({
  label,
  value,
  options,
  onSelect,
  caption,
  compact = false,
  open: openControlled,
  onOpenChange,
  style,
}: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [openInternal, setOpenInternal] = useState(false);
  const open = openControlled ?? openInternal;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (openControlled === undefined) {
      setOpenInternal(next);
    }
  };

  const selected = options.find((o) => o.value === value);
  const sheetTitle = caption ?? label;
  const menuMaxHeight = Math.min(420, Math.round(windowHeight * 0.55));

  return (
    <View style={[styles.wrap, style]}>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={[
          styles.trigger,
          { height: compact ? TRIGGER_H_COMPACT : TRIGGER_H },
          compact && styles.triggerCompact,
          value ? styles.triggerActive : null,
        ]}
        activeOpacity={0.75}
      >
        <View style={styles.triggerTextCol}>
          {caption ? (
            <Text style={[styles.caption, compact && styles.captionCompact]} numberOfLines={1}>
              {caption}
            </Text>
          ) : null}
          <Text
            style={[
              styles.triggerText,
              compact && styles.triggerTextCompact,
              value ? styles.triggerTextActive : null,
            ]}
            numberOfLines={1}
          >
            {selected ? selected.label : label}
          </Text>
        </View>
        <Text style={styles.caret}>▾</Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.sheetTitle}>{sheetTitle}</Text>
            <ScrollView
              style={[styles.menuScroll, { maxHeight: menuMaxHeight }]}
              contentContainerStyle={styles.menu}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {options.map((option, index) => {
                const isSelected = value === option.value;
                const isLast = index === options.length - 1;
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => {
                      onSelect(option.value);
                      setOpen(false);
                    }}
                    style={[
                      styles.option,
                      isSelected && styles.optionSelected,
                      isLast && styles.optionLast,
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        isSelected && styles.optionTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                    {isSelected ? <Text style={styles.check}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Pressable style={styles.cancelBtn} onPress={() => setOpen(false)}>
              <Text style={styles.cancelText}>Bağla</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      minWidth: 0,
    },
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: 8,
      paddingHorizontal: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
      gap: 6,
    },
    triggerCompact: {
      borderRadius: 8,
    },
    triggerActive: {
      borderColor: colors.borderSoft,
    },
    triggerTextCol: {
      flex: 1,
      minWidth: 0,
      justifyContent: 'center',
    },
    caption: {
      fontSize: 10,
      fontWeight: '600',
      color: colors.textMuted,
      marginBottom: 1,
    },
    captionCompact: {
      fontSize: 10,
    },
    triggerText: {
      fontSize: 12,
      color: colors.textMuted,
      fontWeight: '500',
    },
    triggerTextCompact: {
      fontSize: 12,
    },
    triggerTextActive: {
      color: colors.text,
      fontWeight: '600',
    },
    caret: {
      fontSize: 10,
      color: colors.textMuted,
      fontWeight: '700',
    },
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 12,
      paddingTop: 14,
    },
    sheetTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 10,
      letterSpacing: -0.2,
    },
    menuScroll: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
    },
    menu: {
      overflow: 'hidden',
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSoft,
    },
    optionLast: {
      borderBottomWidth: 0,
    },
    optionSelected: {
      backgroundColor: colors.accentSoft,
    },
    optionText: {
      fontSize: 14,
      color: colors.chipText,
      fontWeight: '500',
    },
    optionTextSelected: {
      color: colors.accent,
      fontWeight: '700',
    },
    check: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: '700',
    },
    cancelBtn: {
      marginTop: 10,
      alignItems: 'center',
      paddingVertical: 10,
    },
    cancelText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
    },
  });
}
