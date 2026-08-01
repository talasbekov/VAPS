import { getSession } from "next-auth/react"
import { authOptions } from "@/lib/auth-config"

/**
 * Получает токен доступа из NextAuth сессии
 * Используется в компонентах для передачи токена в API запросы
 */
export async function getAccessToken(): Promise<string | null> {
  const session = await getSession()
  return (session?.user as any)?.accessToken || null
}

/**
 * Создает заголовки для API запросов с токеном авторизации
 */
export async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken()
  
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    accept: "application/json",
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  return headers
}














