/**
 * Local encouragement notifications (weather / popular region tips).
 * Schedules a local notification every ~5 days.
 * Server cron `/api/jobs/encourage` also fans out Expo push for signed-in users.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { REGIONS } from '../constants/regions';
import {
  ensureNotificationPermissions,
  hasPushNativeModule,
} from './pushNotifications';

const LAST_ENCOURAGE_KEY = 'trippoint.last_encourage_at';
const SCHEDULED_ID_KEY = 'trippoint.encourage_notif_id';
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const ANDROID_CHANNEL_ID = 'trippoint-default';

const TIP_POOL = [
  {
    title: 'Səyahət fürsəti',
    body: 'Bu həftəsonu Qubada mülayim hava gözlənilir — səyahət üçün əla fürsətdir.',
  },
  {
    title: 'Kəşf et',
    body: 'Bu həftə ən çox səyahət planlaması Lənkəran olub — sən də nəzər sal.',
  },
  {
    title: 'Təbiət çağırır',
    body: 'Şəki və Qəbələ bu günlərdə populyardır. Yeni marşrut planlamağa dəyər.',
  },
  {
    title: 'Həftəsonu ideyası',
    body: 'Hava uyğundursa yaxın rayona qısa tur qurun — İcma elanlarına da baxın.',
  },
  {
    title: 'İlham',
    body: 'Sevimlilərdə saxladığınız yerlərdən yeni AI marşrut hazırlaya bilərsiniz.',
  },
];

function pickTip(): { title: string; body: string } {
  const weekendish = new Date().getDay() >= 4;
  if (weekendish && REGIONS.length > 0) {
    const region = REGIONS[Math.floor(Math.random() * Math.min(8, REGIONS.length))]!;
    return {
      title: 'Həftəsonu fürsəti',
      body: `Bu həftəsonu ${region.label}-da mülayim hava gözlənilir — səyahət üçün əla fürsətdir.`,
    };
  }
  return TIP_POOL[Math.floor(Math.random() * TIP_POOL.length)]!;
}

/** Configure foreground presentation once per app session. */
export function configureNotificationHandler(): void {
  if (!hasPushNativeModule()) {
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch {
    // Expo Go / missing native module
  }
}

/**
 * Schedule next encouragement ~5 days out.
 * If 5+ days since last tip, returns an in-app message to show now.
 */
export async function ensureEncouragementSchedule(): Promise<string | null> {
  if (!hasPushNativeModule()) {
    return null;
  }

  try {
    if (!(await ensureNotificationPermissions())) {
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');

    const now = Date.now();
    const lastRaw = await AsyncStorage.getItem(LAST_ENCOURAGE_KEY);
    const lastAt = lastRaw ? Number(lastRaw) : 0;
    const due = !lastAt || now - lastAt >= FIVE_DAYS_MS;

    let inAppTip: string | null = null;
    if (due) {
      const tip = pickTip();
      inAppTip = `${tip.title}: ${tip.body}`;
      await AsyncStorage.setItem(LAST_ENCOURAGE_KEY, String(now));
    }

    const prevId = await AsyncStorage.getItem(SCHEDULED_ID_KEY);
    if (prevId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(prevId);
      } catch {
        // ignore
      }
    }

    const tip = pickTip();
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: tip.title,
        body: tip.body,
        data: { kind: 'encourage', source: 'local_scheduled' },
        ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.floor(FIVE_DAYS_MS / 1000),
        repeats: false,
      },
    });
    await AsyncStorage.setItem(SCHEDULED_ID_KEY, id);
    return inAppTip;
  } catch {
    return null;
  }
}

export async function cancelEncouragementSchedule(): Promise<void> {
  if (!hasPushNativeModule()) {
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    const prevId = await AsyncStorage.getItem(SCHEDULED_ID_KEY);
    if (prevId) {
      await Notifications.cancelScheduledNotificationAsync(prevId);
    }
    await AsyncStorage.removeItem(SCHEDULED_ID_KEY);
  } catch {
    // ignore
  }
}
