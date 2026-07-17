import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#2563EB',
        tabBarInactiveTintColor: '#9CA3AF',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Ana səhifə',
          tabBarIcon: ({ color, size }) => (
            <FontAwesome name="map-marker" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="marsrut"
        options={{
          title: 'Marşrut',
          tabBarIcon: ({ color, size }) => (
            <FontAwesome name="compass" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="ai-komekci"
        options={{
          title: 'AI',
          tabBarLabel: 'AI',
          tabBarActiveTintColor: '#7C3AED',
          tabBarIcon: ({ focused }) => (
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: focused ? '#7C3AED' : '#E5E7EB',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 16, lineHeight: 20 }}>✨</Text>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="icma"
        options={{
          title: 'İcma',
          tabBarIcon: ({ color, size }) => (
            <FontAwesome name="users" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profil"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, size }) => (
            <FontAwesome name="user" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
