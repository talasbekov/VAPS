// Типы для обратной связи

export interface FeedbackMessage {
  id: number;
  message: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
}

export interface FeedbackResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: FeedbackMessage[];
}








