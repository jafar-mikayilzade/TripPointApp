export type Region = {
  id: string;
  label: string;
  /** Locative for titles, e.g. "Qubada". Optional — UI falls back to label. */
  locative?: string;
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
  /** Higher = shown earlier in pickers (tourism priority). */
  tourismRank?: number;
};

const DELTA = 0.28;

/**
 * All Azerbaijan cities + rayons.
 * `id` must match Supabase `pois.region` and API `REGION_COORDINATES` (lowercase).
 * Sorted by tourismRank desc, then label.
 */
const REGION_ROWS: Omit<Region, 'latitudeDelta' | 'longitudeDelta'>[] = [
  { id: 'baku', label: 'Bakı', locative: 'Bakıda', latitude: 40.4093, longitude: 49.8671, tourismRank: 100 },
  { id: 'quba', label: 'Quba', locative: 'Qubada', latitude: 41.3625, longitude: 48.5128, tourismRank: 95 },
  { id: 'qusar', label: 'Qusar', locative: 'Qusarda', latitude: 41.601, longitude: 48.4295, tourismRank: 95 },
  { id: 'seki', label: 'Şəki', locative: 'Şəkidə', latitude: 41.1997, longitude: 47.1706, tourismRank: 95 },
  { id: 'qabala', label: 'Qəbələ', locative: 'Qəbələdə', latitude: 40.9981, longitude: 47.8453, tourismRank: 95 },
  { id: 'susa', label: 'Şuşa', locative: 'Şuşada', latitude: 39.7602, longitude: 46.7499, tourismRank: 95 },
  { id: 'ismayilli', label: 'İsmayıllı', locative: 'İsmayıllıda', latitude: 40.7849, longitude: 48.1514, tourismRank: 90 },
  { id: 'lerik', label: 'Lerik', locative: 'Lerikdə', latitude: 38.7736, longitude: 48.415, tourismRank: 90 },
  { id: 'gence', label: 'Gəncə', locative: 'Gəncədə', latitude: 40.6828, longitude: 46.3606, tourismRank: 90 },
  { id: 'goygol', label: 'Göygöl', locative: 'Göygöldə', latitude: 40.5858, longitude: 46.3189, tourismRank: 90 },
  { id: 'samaxi', label: 'Şamaxı', locative: 'Şamaxıda', latitude: 40.6304, longitude: 48.6414, tourismRank: 85 },
  { id: 'lenkeran', label: 'Lənkəran', locative: 'Lənkəranda', latitude: 38.7543, longitude: 48.8506, tourismRank: 85 },
  { id: 'zaqatala', label: 'Zaqatala', locative: 'Zaqatalada', latitude: 41.6336, longitude: 46.6433, tourismRank: 80 },
  { id: 'naxcivan', label: 'Naxçıvan', locative: 'Naxçıvanda', latitude: 39.2089, longitude: 45.4122, tourismRank: 80 },
  { id: 'xacmaz', label: 'Xaçmaz', locative: 'Xaçmazda', latitude: 41.4635, longitude: 48.8063, tourismRank: 75 },
  { id: 'qax', label: 'Qax', locative: 'Qaxda', latitude: 41.4225, longitude: 46.9242, tourismRank: 75 },
  { id: 'qobustan', label: 'Qobustan', locative: 'Qobustanda', latitude: 40.5333, longitude: 48.9333, tourismRank: 70 },
  { id: 'astara', label: 'Astara', locative: 'Astarada', latitude: 38.456, longitude: 48.8786, tourismRank: 70 },
  { id: 'ordubad', label: 'Ordubad', locative: 'Ordubadda', latitude: 38.9081, longitude: 46.0228, tourismRank: 70 },
  { id: 'naftalan', label: 'Naftalan', locative: 'Naftalanda', latitude: 40.5083, longitude: 46.825, tourismRank: 70 },
  { id: 'balaken', label: 'Balakən', locative: 'Balakəndə', latitude: 41.7258, longitude: 46.4083, tourismRank: 60 },
  { id: 'kelbecer', label: 'Kəlbəcər', locative: 'Kəlbəcərdə', latitude: 40.1064, longitude: 46.0381, tourismRank: 60 },
  { id: 'xizi', label: 'Xızı', locative: 'Xızıda', latitude: 40.9103, longitude: 49.0694, tourismRank: 55 },
  { id: 'oguz', label: 'Oğuz', locative: 'Oğuzda', latitude: 41.0708, longitude: 47.4583, tourismRank: 55 },
  { id: 'lacin', label: 'Laçın', locative: 'Laçında', latitude: 39.6333, longitude: 46.55, tourismRank: 55 },
  { id: 'sahbuz', label: 'Şahbuz', locative: 'Şahbuzda', latitude: 39.4, longitude: 45.5667, tourismRank: 55 },
  { id: 'siyazen', label: 'Siyəzən', locative: 'Siyəzəndə', latitude: 41.0769, longitude: 49.1117, tourismRank: 50 },
  { id: 'gedebey', label: 'Gədəbəy', locative: 'Gədəbəydə', latitude: 40.5656, longitude: 45.8161, tourismRank: 50 },
  { id: 'yardimli', label: 'Yardımlı', locative: 'Yardımlıda', latitude: 38.9075, longitude: 48.2406, tourismRank: 50 },
  { id: 'xankendi', label: 'Xankəndi', locative: 'Xankəndidə', latitude: 39.8265, longitude: 46.7656, tourismRank: 50 },
  { id: 'sabran', label: 'Şabran', locative: 'Şabranda', latitude: 41.2019, longitude: 48.9872, tourismRank: 45 },
  { id: 'masalli', label: 'Masallı', locative: 'Masallıda', latitude: 39.0358, longitude: 48.6656, tourismRank: 45 },
  { id: 'absheron', label: 'Abşeron', locative: 'Abşeronda', latitude: 40.4482, longitude: 49.7267, tourismRank: 40 },
  { id: 'culfa', label: 'Culfa', locative: 'Culfada', latitude: 38.9558, longitude: 45.6308, tourismRank: 40 },
  { id: 'dashkesen', label: 'Daşkəsən', locative: 'Daşkəsəndə', latitude: 40.5217, longitude: 46.0828, tourismRank: 40 },
  { id: 'tovuz', label: 'Tovuz', locative: 'Tovuzda', latitude: 40.9925, longitude: 45.6289, tourismRank: 40 },
  { id: 'agdam', label: 'Ağdam', locative: 'Ağdamda', latitude: 39.991, longitude: 46.9309, tourismRank: 35 },
  { id: 'mingechevir', label: 'Mingəçevir', locative: 'Mingəçevirdə', latitude: 40.7631, longitude: 47.0594, tourismRank: 35 },
  { id: 'samkir', label: 'Şəmkir', locative: 'Şəmkirdə', latitude: 40.8297, longitude: 46.0172, tourismRank: 35 },
  { id: 'agsu', label: 'Ağsu', locative: 'Ağsuda', latitude: 40.5703, longitude: 48.4009, tourismRank: 30 },
  { id: 'babek', label: 'Babək', locative: 'Babəkdə', latitude: 39.15, longitude: 45.45, tourismRank: 30 },
  { id: 'fuzuli', label: 'Füzuli', locative: 'Füzulidə', latitude: 39.6003, longitude: 47.1431, tourismRank: 30 },
  { id: 'qazax', label: 'Qazax', locative: 'Qazaxda', latitude: 41.0933, longitude: 45.3661, tourismRank: 30 },
  { id: 'zengilan', label: 'Zəngilan', locative: 'Zəngilanda', latitude: 39.0833, longitude: 46.65, tourismRank: 30 },
  { id: 'agstafa', label: 'Ağstafa', locative: 'Ağstafada', latitude: 41.1189, longitude: 45.4539, tourismRank: 25 },
  { id: 'cebrayil', label: 'Cəbrayıl', locative: 'Cəbrayılda', latitude: 39.4, longitude: 47.0261, tourismRank: 25 },
  { id: 'goranboy', label: 'Goranboy', locative: 'Goranboyda', latitude: 40.6103, longitude: 46.7897, tourismRank: 25 },
  { id: 'qubadli', label: 'Qubadlı', locative: 'Qubadlıda', latitude: 39.3444, longitude: 46.58, tourismRank: 25 },
  { id: 'salyan', label: 'Salyan', locative: 'Salyanda', latitude: 39.595, longitude: 48.9839, tourismRank: 25 },
  { id: 'serur', label: 'Şərur', locative: 'Şərurda', latitude: 39.5528, longitude: 44.9806, tourismRank: 25 },
  { id: 'sumqayit', label: 'Sumqayıt', locative: 'Sumqayıtda', latitude: 40.5897, longitude: 49.6686, tourismRank: 25 },
  { id: 'terter', label: 'Tərtər', locative: 'Tərtərdə', latitude: 40.3419, longitude: 46.9306, tourismRank: 25 },
  { id: 'xocali', label: 'Xocalı', locative: 'Xocalıda', latitude: 39.9111, longitude: 46.7892, tourismRank: 25 },
  { id: 'xocavend', label: 'Xocavənd', locative: 'Xocavənddə', latitude: 39.7953, longitude: 47.1131, tourismRank: 25 },
  { id: 'berde', label: 'Bərdə', locative: 'Bərdədə', latitude: 40.3758, longitude: 47.1267, tourismRank: 20 },
  { id: 'celilabad', label: 'Cəlilabad', locative: 'Cəlilabadda', latitude: 39.2096, longitude: 48.4919, tourismRank: 20 },
  { id: 'goycay', label: 'Göyçay', locative: 'Göyçayda', latitude: 40.6531, longitude: 47.7406, tourismRank: 20 },
  { id: 'haciqabul', label: 'Hacıqabul', locative: 'Hacıqabulda', latitude: 40.0387, longitude: 48.9429, tourismRank: 20 },
  { id: 'kengerli', label: 'Kəngərli', locative: 'Kəngərlidə', latitude: 39.4, longitude: 45.1167, tourismRank: 20 },
  { id: 'neftcala', label: 'Neftçala', locative: 'Neftçalada', latitude: 39.3742, longitude: 49.2472, tourismRank: 20 },
  { id: 'samux', label: 'Samux', locative: 'Samuxda', latitude: 40.7667, longitude: 46.5056, tourismRank: 20 },
  { id: 'sederek', label: 'Sədərək', locative: 'Sədərəkdə', latitude: 39.7167, longitude: 44.8833, tourismRank: 20 },
  { id: 'sirvan', label: 'Şirvan', locative: 'Şirvanda', latitude: 39.9319, longitude: 48.9294, tourismRank: 20 },
  { id: 'agcabedi', label: 'Ağcabədi', locative: 'Ağcabədidə', latitude: 40.0502, longitude: 47.4593, tourismRank: 15 },
  { id: 'agdas', label: 'Ağdaş', locative: 'Ağdaşda', latitude: 40.65, longitude: 47.4761, tourismRank: 15 },
  { id: 'beyleqan', label: 'Beyləqan', locative: 'Beyləqanda', latitude: 39.7756, longitude: 47.6186, tourismRank: 15 },
  { id: 'bilasuvar', label: 'Biləsuvar', locative: 'Biləsuvarda', latitude: 39.4583, longitude: 48.545, tourismRank: 15 },
  { id: 'kurdemir', label: 'Kürdəmir', locative: 'Kürdəmirdə', latitude: 40.3453, longitude: 48.1569, tourismRank: 15 },
  { id: 'yevlax', label: 'Yevlax', locative: 'Yevlaxda', latitude: 40.6636, longitude: 47.1421, tourismRank: 15 },
  { id: 'imisli', label: 'İmişli', locative: 'İmişlidə', latitude: 39.8697, longitude: 48.06, tourismRank: 10 },
  { id: 'saatli', label: 'Saatlı', locative: 'Saatlıda', latitude: 39.9311, longitude: 48.3697, tourismRank: 10 },
  { id: 'sabirabad', label: 'Sabirabad', locative: 'Sabirabadda', latitude: 40.0089, longitude: 48.4772, tourismRank: 10 },
  { id: 'ucar', label: 'Ucar', locative: 'Ucarda', latitude: 40.5192, longitude: 47.6542, tourismRank: 10 },
  { id: 'zerdab', label: 'Zərdab', locative: 'Zərdabda', latitude: 40.2183, longitude: 47.7125, tourismRank: 10 },
];

export const REGIONS: Region[] = [...REGION_ROWS]
  .sort((a, b) => (b.tourismRank ?? 0) - (a.tourismRank ?? 0) || a.label.localeCompare(b.label, 'az'))
  .map((r) => ({
    ...r,
    latitudeDelta: DELTA,
    longitudeDelta: DELTA,
  }));

/** Featured tourism destinations (rank >= 50) — shorter pickers / bot menus. */
export const TOURISM_FEATURED_REGIONS: Region[] = REGIONS.filter(
  (r) => (r.tourismRank ?? 0) >= 50
);

export const DEFAULT_REGION_ID = 'quba';

export function getRegionById(id: string | null | undefined): Region | undefined {
  if (!id) return undefined;
  const key = id.trim().toLowerCase();
  return REGIONS.find((r) => r.id === key);
}
