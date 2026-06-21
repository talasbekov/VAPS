import "next-auth"
import "next-auth/jwt"

declare module "next-auth" {
  interface Session {
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
    role?: any
    userData?: any
  }
}

