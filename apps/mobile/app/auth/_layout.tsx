import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" options={{ title: 'Daxil ol' }} />
      <Stack.Screen name="register" options={{ title: 'Qeydiyyat' }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Şifrəni unutdum' }} />
      <Stack.Screen name="reset-password" options={{ title: 'Yeni şifrə' }} />
      <Stack.Screen name="callback" options={{ title: 'Təsdiq' }} />
    </Stack>
  );
}
