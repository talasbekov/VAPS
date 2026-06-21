// Публичный API фичи edit-profile

export { EditProfileDialog } from "./ui/EditProfileDialog";

// Экспортируем типы
export type {
  UpdateProfileRequest,
  UpdateProfileResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
} from "./model/types";

// Экспортируем API функции
export { updateProfile, changePassword } from "./api/edit-profile-api";








