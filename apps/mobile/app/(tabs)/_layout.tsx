import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, shadows } from '../../constants/theme';

/** Ana səhifə: nazik dairə + mərkəz nöqtə (referans navbar) */
function HomeTabIcon({ color, size }: { color: string; size: number }) {
  const outer = size;
  const inner = Math.max(5, Math.round(size * 0.28));
  return (
    <View
      style={{
        width: outer,
        height: outer,
        borderRadius: outer / 2,
        borderWidth: 1.6,
        borderColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10);
  const tabBarHeight = 52 + bottomPad;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
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
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Ana səhifə',
          tabBarIcon: ({ color, size }) => <HomeTabIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="ai-komekci"
        options={{
          title: 'Qur',
          tabBarLabel: 'Qur',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="construct-outline" size={size + 1} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="marsrut"
        options={{
          title: 'Marşrut',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="map-marker-path" size={size + 1} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="icma"
        options={{
          title: 'İcma',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size + 1} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="sevimliler"
        options={{
          title: 'Sevimlilər',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bookmark-outline" size={size} color={color} />
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
