// Supabase cədvəllərinə uyğun TypeScript tipləri.
//
// Qeyd: bu tiplər `interface` yox, `type` alias kimi yazılıb. Səbəb:
// supabase-js-in generic sxem yoxlaması (`GenericTable.Row extends
// Record<string, unknown>`) yalnız object type alias-ları qəbul edir —
// `interface` bəyannaməsi bu yoxlamadan keçmir və nəticədə sorğular
// səhvən `never` tipinə düşür.

export type UserRole = 'admin' | 'user' | 'guide' | 'business_owner' | 'local_provider';

export type ListingType = 'carpool' | 'tour' | 'local_service';

export type ListingStatus = 'active' | 'inactive' | 'completed' | 'cancelled';

export type ListingPriceType = 'per_person' | 'per_trip' | 'negotiable' | 'free';

export type LocalServiceCategory =
  | 'offroad'
  | 'private_guide'
  | 'home_rental'
  | 'other_service';

export type PoiStatus = 'pending' | 'approved' | 'rejected';

export type PhotoModerationStatus = 'pending' | 'approved' | 'rejected';

export type ListingReportStatus = 'open' | 'reviewed' | 'dismissed' | 'actioned';

export type PoiCategory =
  | 'restaurant'
  | 'cafe'
  | 'hotel'
  | 'hostel'
  | 'home_restaurant'
  | 'guesthouse'
  | 'nature'
  | 'waterfall'
  | 'mountain'
  | 'lake'
  | 'historical'
  | 'monument'
  | 'other';

export type ParticipantStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type RatingTargetType = 'poi' | 'listing' | 'business' | 'profile' | 'post';

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  role: UserRole;
  bio: string | null;
  rating_avg: number | null;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Poi = {
  id: string;
  name: string;
  description: string | null;
  category: PoiCategory;
  status: PoiStatus;
  region: string;
  lat: number;
  lng: number;
  /** PostGIS / geography — optional, DB-də ola bilər */
  location?: unknown;
  address: string | null;
  phone: string | null;
  website: string | null;
  /** External (Google) rating 1–5; OSM usually null */
  rating: number | null;
  rating_count: number | null;
  place_id?: string | null;
  submitted_by: string;
  created_at: string;
  updated_at: string;
};

export type PoiPhoto = {
  id: string;
  poi_id: string;
  photo_url: string;
  order_index: number;
  status: PhotoModerationStatus;
  uploaded_by: string | null;
  created_at: string;
};

export type ListingReport = {
  id: string;
  listing_id: string;
  reporter_id: string;
  reason: string;
  details: string | null;
  status: ListingReportStatus;
  created_at: string;
};

export type Favorite = {
  id: string;
  user_id: string;
  target_type: 'poi' | 'listing';
  target_id: string;
  created_at: string;
};

export type Listing = {
  id: string;
  created_by: string;
  type: ListingType;
  status: ListingStatus;
  title: string;
  description: string | null;
  region: string | null;
  origin_text: string | null;
  destination_text: string | null;
  departure_lat: number | null;
  departure_lng: number | null;
  destination_lat: number | null;
  destination_lng: number | null;
  departure_at: string | null;
  spots_left: number | null;
  capacity: number | null;
  max_participants: number | null;
  price: number | null;
  price_type: ListingPriceType | null;
  is_recurring: boolean;
  contact_phone: string | null;
  service_category: LocalServiceCategory | null;
  created_at: string;
  updated_at: string;
};

export type ListingPoi = {
  id: string;
  listing_id: string;
  poi_id: string;
  sort_order: number | null;
  created_at: string;
};

export type ListingParticipant = {
  id: string;
  listing_id: string;
  user_id: string;
  status: ParticipantStatus;
  message: string | null;
  created_at: string;
};

export type TravelPrivacy = 'public' | 'private';

export type TravelHistory = {
  id: string;
  user_id: string;
  poi_id: string | null;
  listing_id: string | null;
  title: string;
  notes: string | null;
  visited_at: string;
  privacy: TravelPrivacy;
  created_at: string;
};

export type TravelHistoryPhoto = {
  id: string;
  history_id: string;
  photo_url: string;
  lat: number | null;
  lng: number | null;
  order_index: number;
  created_at: string;
};

export type GuideTourHistory = {
  guide_id: string;
  listing_id: string;
  title: string;
  departure_at: string | null;
  completed_at: string | null;
  participant_count: number;
  poi_names: string[] | null;
};

export type Rating = {
  id: string;
  rater_id: string;
  target_type: RatingTargetType;
  target_id: string;
  score: number;
  comment: string | null;
  created_at: string;
};

export type Post = {
  id: string;
  user_id: string;
  caption: string;
  poi_id: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
  updated_at: string;
};

export type PostPhoto = {
  id: string;
  post_id: string;
  url: string;
  sort_order: number | null;
  created_at: string;
};

export type ExpenseGroupStatus = 'active' | 'settled';

export type ExpenseGroup = {
  id: string;
  created_by: string;
  name: string;
  listing_id: string | null;
  status: ExpenseGroupStatus;
  created_at: string;
};

export type ExpenseGroupMember = {
  id: string;
  group_id: string;
  user_id: string;
  created_at: string;
};

export type Expense = {
  id: string;
  group_id: string;
  paid_by: string;
  amount: number;
  description: string;
  created_at: string;
};

// Supabase-js-in `createClient<Database>()` generic-i üçün.
// Hər cədvəl üçün Row (oxunan sətir), Insert (yaradılan zaman lazım olan
// minimal sahələr, qalanları optional), Update (hamısı optional) və
// Relationships (foreign key-lər — burada real sxem introspeksiyası
// olmadığı üçün boş saxlanılıb) tipləri.
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & Pick<Profile, 'id'>;
        Update: Partial<Profile>;
        Relationships: [];
      };
      pois: {
        Row: Poi;
        Insert: Pick<Poi, 'name' | 'category' | 'region' | 'lat' | 'lng' | 'submitted_by'> &
          Partial<Omit<Poi, 'name' | 'category' | 'region' | 'lat' | 'lng' | 'submitted_by'>>;
        Update: Partial<Poi>;
        Relationships: [];
      };
      poi_photos: {
        Row: PoiPhoto;
        Insert: Pick<PoiPhoto, 'poi_id' | 'photo_url'> &
          Partial<Omit<PoiPhoto, 'poi_id' | 'photo_url'>>;
        Update: Partial<PoiPhoto>;
        Relationships: [];
      };
      listing_reports: {
        Row: ListingReport;
        Insert: Pick<ListingReport, 'listing_id' | 'reporter_id' | 'reason'> &
          Partial<Omit<ListingReport, 'listing_id' | 'reporter_id' | 'reason'>>;
        Update: Partial<ListingReport>;
        Relationships: [];
      };
      favorites: {
        Row: Favorite;
        Insert: Pick<Favorite, 'user_id' | 'target_type' | 'target_id'> &
          Partial<Omit<Favorite, 'user_id' | 'target_type' | 'target_id'>>;
        Update: Partial<Favorite>;
        Relationships: [];
      };
      listings: {
        Row: Listing;
        Insert: Pick<Listing, 'created_by' | 'type' | 'title'> &
          Partial<Omit<Listing, 'created_by' | 'type' | 'title'>>;
        Update: Partial<Listing>;
        Relationships: [];
      };
      listing_pois: {
        Row: ListingPoi;
        Insert: Pick<ListingPoi, 'listing_id' | 'poi_id'> &
          Partial<Omit<ListingPoi, 'listing_id' | 'poi_id'>>;
        Update: Partial<ListingPoi>;
        Relationships: [];
      };
      listing_participants: {
        Row: ListingParticipant;
        Insert: Pick<ListingParticipant, 'listing_id' | 'user_id'> &
          Partial<Omit<ListingParticipant, 'listing_id' | 'user_id'>>;
        Update: Partial<ListingParticipant>;
        Relationships: [];
      };
      travel_history: {
        Row: TravelHistory;
        Insert: Pick<TravelHistory, 'user_id' | 'title' | 'visited_at'> &
          Partial<Omit<TravelHistory, 'user_id' | 'title' | 'visited_at'>>;
        Update: Partial<TravelHistory>;
        Relationships: [];
      };
      travel_history_photos: {
        Row: TravelHistoryPhoto;
        Insert: Pick<TravelHistoryPhoto, 'history_id' | 'photo_url'> &
          Partial<Omit<TravelHistoryPhoto, 'history_id' | 'photo_url'>>;
        Update: Partial<TravelHistoryPhoto>;
        Relationships: [];
      };
      ratings: {
        Row: Rating;
        Insert: Pick<Rating, 'rater_id' | 'target_type' | 'target_id' | 'score'> &
          Partial<Omit<Rating, 'rater_id' | 'target_type' | 'target_id' | 'score'>>;
        Update: Partial<Rating>;
        Relationships: [];
      };
      posts: {
        Row: Post;
        Insert: Pick<Post, 'user_id' | 'caption'> & Partial<Omit<Post, 'user_id' | 'caption'>>;
        Update: Partial<Post>;
        Relationships: [];
      };
      post_photos: {
        Row: PostPhoto;
        Insert: Pick<PostPhoto, 'post_id' | 'url'> & Partial<Omit<PostPhoto, 'post_id' | 'url'>>;
        Update: Partial<PostPhoto>;
        Relationships: [];
      };
      expense_groups: {
        Row: ExpenseGroup;
        Insert: Pick<ExpenseGroup, 'created_by' | 'name'> &
          Partial<Omit<ExpenseGroup, 'created_by' | 'name'>>;
        Update: Partial<ExpenseGroup>;
        Relationships: [];
      };
      expense_group_members: {
        Row: ExpenseGroupMember;
        Insert: Pick<ExpenseGroupMember, 'group_id' | 'user_id'> &
          Partial<Omit<ExpenseGroupMember, 'group_id' | 'user_id'>>;
        Update: Partial<ExpenseGroupMember>;
        Relationships: [];
      };
      expenses: {
        Row: Expense;
        Insert: Pick<Expense, 'group_id' | 'paid_by' | 'amount' | 'description'> &
          Partial<Omit<Expense, 'group_id' | 'paid_by' | 'amount' | 'description'>>;
        Update: Partial<Expense>;
        Relationships: [];
      };
    };
    Views: {
      guide_tour_history: {
        Row: GuideTourHistory;
        Relationships: [];
      };
    };
    Functions: {
      delete_own_account: {
        Args: Record<PropertyKey, never>;
        Returns: { ok: boolean; user_id: string };
      };
      cancel_listing: {
        Args: { p_listing_id: string };
        Returns: undefined;
      };
      admin_update_listing: {
        Args: {
          p_listing_id: string;
          p_title?: string | null;
          p_description?: string | null;
          p_status?: string | null;
          p_price?: number | null;
          p_contact_phone?: string | null;
          p_spots_left?: number | null;
        };
        Returns: undefined;
      };
      set_listing_route_pois: {
        Args: { p_listing_id: string; p_poi_ids: string[] };
        Returns: undefined;
      };
      get_listing_route_poi_names: {
        Args: { p_listing_id: string };
        Returns: { name: string; sort_order: number | null }[];
      };
    };
  };
};
