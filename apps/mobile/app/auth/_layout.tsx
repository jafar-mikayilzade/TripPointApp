import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" options={{ title: 'Daxil ol' }} />
      <Stack.Screen name="register" options={{ title: 'Qeydiyyat' }} />
      <Stack.Screen name="callback" options={{ title: 'Təsdiq' }} />
    </Stack>
  );
}
