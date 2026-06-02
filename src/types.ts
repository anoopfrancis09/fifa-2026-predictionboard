export type ProfileRole = 'user' | 'admin';
export type MatchStatus = 'upcoming' | 'finished';
export type PredictionChoice = 'team_a' | 'draw' | 'team_b';

export interface Profile {
  id: string;
  username: string;
  role: ProfileRole;
  balance: number;
  created_at?: string;
  updated_at?: string;
}

export interface Match {
  id: string;
  team_a: string;
  team_b: string;
  team_a_weight: number;
  draw_weight: number;
  team_b_weight: number;
  match_time: string;
  status: MatchStatus;
  result: PredictionChoice | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface Prediction {
  id: string;
  match_id: string;
  user_id: string;
  choice: PredictionChoice;
  amount: number;
  payout_amount: number;
  net_amount: number;
  result_weight: number | null;
  created_at: string;
  updated_at: string;
}

export interface MatchResultRow {
  prediction_id: string;
  user_id: string;
  username: string;
  choice: PredictionChoice;
  choice_weight: number;
  amount: number | null;
  payout_amount: number | null;
  net_amount: number | null;
  is_me: boolean;
}
