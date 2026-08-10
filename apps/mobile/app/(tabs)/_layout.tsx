import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { shadows } from '../../constants/theme';
import { useResponsiveLayout } from '../../lib/layout';
import { useThemeColors } from '../../theme/ThemeProvider';

const ACTIVE_BG = '#0D2C24';

type IonName = ComponentProps<typeof Ionicons>['name'];

type TabIconProps = {
  name: IonName;
  nameFocused: IonName;
  color: string;
  size: number;
  focused: boolean;
};

function TabIcon({ name, nameFocused, color, size, focused }: TabIconProps) {
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
      <Ionicons
        name={focused ? nameFocused : name}
        size={size - (focused ? 1 : 0)}
        color={focused ? '#FFFFFF' : color}
      />
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { isCompact } = useResponsiveLayout();
  const colors = useThemeColors();
  const bottomPad = Math.max(insets.bottom, 10);
  const tabBarHeight = 56 + bottomPad;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 0,
          height: tabBarHeight,
          paddingBottom: bottomPad,
          paddingTop: 6,
          ...shadows.bar,
        },
        tabBarLabelStyle: {
          fontSize: isCompact ? 10 : 11,
          fontWeight: '700',
        },
        tabBarAllowFontScaling: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Ana səhifə',
          tabBarLabel: isCompact ? 'Ana' : 'Ana səhifə',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              name="location-outline"
              nameFocused="location"
              color={String(color)}
              size={size}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="ai-komekci"
        options={{
          title: 'Qur',
          tabBarLabel: 'Qur',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              name="compass-outline"
              nameFocused="compass"
              color={String(color)}
              size={size + 1}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="marsrut"
        options={{
          title: 'Marşrut',
          tabBarLabel: isCompact ? 'AI' : 'Marşrut',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              name="sparkles-outline"
              nameFocused="sparkles"
              color={String(color)}
              size={size}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="icma"
        options={{
          title: 'İcma',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              name="people-outline"
              nameFocused="people"
              color={String(color)}
              size={size + 1}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="sevimliler"
        options={{
          title: 'Sevimlilər',
          tabBarLabel: isCompact ? 'Sevimli' : 'Sevimlilər',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              name="bookmark-outline"
              nameFocused="bookmark"
              color={String(color)}
              size={size}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profil"
        options={{
          href: null,
          title: 'Profil',
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: ACTIVE_BG,
  },
});
