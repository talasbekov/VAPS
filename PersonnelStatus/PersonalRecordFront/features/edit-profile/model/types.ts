// Типы для редактирования профиля

export interface UpdateProfileRequest {
  first_name?: string;
  last_name?: string;
  email?: string;
}

export interface UpdateProfileResponse {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  name: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface ChangePasswordResponse {
  message?: string;
}

