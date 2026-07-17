export type Region = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

// `id` Supabase `pois.region` dəyəri ilə eyni olmalıdır (lowercase).
export const REGIONS: Region[] = [
  {
    id: 'quba',
    label: 'Quba',
    latitude: 41.3625,
    longitude: 48.5128,
    latitudeDelta: 0.25,
    longitudeDelta: 0.25,
  },
  {
    id: 'qusar',
    label: 'Qusar',
    latitude: 41.601,
    longitude: 48.4295,
    latitudeDelta: 0.25,
    longitudeDelta: 0.25,
  },
  {
    id: 'seki',
    label: 'Şəki',
    latitude: 41.1997,
    longitude: 47.1706,
    latitudeDelta: 0.25,
    longitudeDelta: 0.25,
  },
  {
    id: 'lerik',
    label: 'Lerik',
    latitude: 38.7736,
    longitude: 48.415,
    latitudeDelta: 0.25,
    longitudeDelta: 0.25,
  },
  {
    id: 'qabala',
    label: 'Qəbələ',
    latitude: 40.9981,
    longitude: 47.8453,
    latitudeDelta: 0.25,
    longitudeDelta: 0.25,
  },
];

export const DEFAULT_REGION_ID = 'quba';
