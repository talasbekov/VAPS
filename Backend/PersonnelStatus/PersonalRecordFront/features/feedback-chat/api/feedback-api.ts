// API функции для обратной связи

import { getAccessToken } from "@/lib/api";
import { BACKEND_URL } from "@/shared/config/env";
import type { FeedbackMessage, FeedbackResponse } from "../model/types";

/**
 * Получает список сообщений обратной связи
 */
export async function getFeedback(
  page: number = 1,
  pageSize: number = 10
): Promise<FeedbackResponse> {
  const endpoint = `/api/dictionaries/feedback/?page=${page}&page_size=${pageSize}`;
  const url = `${BACKEND_URL}${endpoint}`;

  const token = await getAccessToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    accept: "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data as FeedbackResponse;
  } catch (error) {
    console.error("Failed to fetch feedback", error);
    throw error;
  }
}

/**
 * Отправляет новое сообщение обратной связи
 */
export async function sendFeedback(message: string): Promise<FeedbackMessage> {
  const endpoint = `/api/dictionaries/feedback/`;
  const url = `${BACKEND_URL}${endpoint}`;

  const token = await getAccessToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    accept: "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      let errorMessage = `HTTP error! status: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.detail) {
          errorMessage = errorData.detail;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }
      } catch (e) {
        // Игнорируем ошибку парсинга
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data as FeedbackMessage;
  } catch (error) {
    console.error("Failed to send feedback", error);
    throw error;
  }
}
