import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@trippoint/first-run-coach-v1';

export async function hasSeenFirstRunCoach(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return true;
  }
}

export async function markFirstRunCoachSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // ignore
  }
}
