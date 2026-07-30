export interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  birthdate: string | null;
  pedas_attended: number;
  blocked_users: string[];
  eula_accepted_at: string | null;
  onboarding_completed: boolean;
  push_token: string | null;
  follower_count: number;
  following_count: number;
  created_at: string;
}

export interface Peda {
  id: string;
  name: string;
  address: string | null;
  starts_at: string;
  expires_at: string;
  is_private: boolean;
  invite_code: string | null;
  created_by: string;
  attendee_count: number;
  emoji: string;
  created_at: string;
}

export interface NearbyPeda {
  id: string;
  name: string;
  address: string | null;
  starts_at: string;
  expires_at: string;
  is_private: boolean;
  attendee_count: number;
  created_by: string;
  distance_km: number;
  lat: number;
  lng: number;
  emoji: string;
}

export interface PedaAttendee {
  peda_id: string;
  user_id: string;
  joined_at: string;
}

export type MediaType = "photo" | "video";
export type ModerationStatus = "pending" | "approved" | "rejected";

export interface Post {
  id: string;
  peda_id: string | null;
  user_id: string;
  media_url: string;
  media_type: MediaType;
  thumbnail_url: string | null;
  caption: string | null;
  moderation_status: ModerationStatus;
  like_count: number;
  comment_count: number;
  blur_data: string | null;
  created_at: string;
  profiles?: Profile;
  liked_by_me?: boolean;
}

export type FollowStatus = "pending" | "accepted" | "declined";

export interface Follow {
  id: string;
  follower_id: string;
  following_id: string;
  status: FollowStatus;
  created_at: string;
  profiles?: Profile;
}

export interface Like {
  id: string;
  user_id: string;
  post_id: string;
  created_at: string;
}

export interface Comment {
  id: string;
  user_id: string;
  post_id: string;
  text: string;
  created_at: string;
  profiles?: Profile;
}

export type ReportReason =
  | "spam"
  | "inappropriate"
  | "harassment"
  | "underage"
  | "other";

export interface Report {
  id: string;
  reporter_id: string;
  target_type: "post" | "peda" | "user";
  target_id: string;
  reason: ReportReason;
  description: string | null;
  status: "pending" | "reviewed" | "actioned";
  created_at: string;
}
