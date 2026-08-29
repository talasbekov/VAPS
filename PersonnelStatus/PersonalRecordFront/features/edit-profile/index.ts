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
export {
  updateProfile,
  changePassword,
  ProfileApiError,
} from "./api/edit-profile-api";








