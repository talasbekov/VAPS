import "next-auth"
import "next-auth/jwt"

declare module "next-auth" {
  interface Session {
    /** «Продлить access-токен не удалось — войдите заново» (Plane №383).
     *  Клиент читает это поле и уводит на форму входа. */
    error?: string
    user: {
      id: string
      email: string
      name: string
      accessToken?: string
      role?: any
      userData?: any
    }
  }

  interface User {
    id: string
    email: string
    name: string
    accessToken?: string
    refreshToken?: string
    role?: any
    userData?: any
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    accessToken?: string
    refreshToken?: string
    /** Момент истечения access-токена (мс), прочитанный из его `exp`.
     *  По нему колбэк `jwt` решает, пора ли продлевать (Plane №383). */
    accessTokenExpires?: number | null
    error?: string
    role?: any
    userData?: any
  }
}

