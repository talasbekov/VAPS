"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import "@/components/shell-visual.css";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { PORTAL_HOME_PATH } from "@/features/portal-workspace/model";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Куда вернуть после входа. Берём только ВНУТРЕННИЙ путь: `callbackUrl` живёт
 * в адресной строке, и абсолютный адрес оттуда увёл бы человека на чужой сайт
 * сразу после успешного логина.
 */
function safeCallbackUrl(raw: string | null): string | null {
  if (raw === null || raw === "") return null;
  // Middleware NextAuth кладёт сюда АБСОЛЮТНЫЙ адрес
  // (`http://localhost:3106/employees/`), а не путь: наивная проверка
  // «начинается со слэша» отбрасывала его целиком, и возврат не работал.
  try {
    const target = new URL(raw, window.location.origin);
    if (target.origin !== window.location.origin) return null;
    // Обратно на форму входа не возвращаем — получился бы круг.
    if (target.pathname === "/") return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

export default function LoginPage() {
  // useSearchParams требует границы Suspense: без неё пререндер страницы
  // падает на сборке («should be wrapped in a suspense boundary»).
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LoginScreen />
    </Suspense>
  );
}

function LoginScreen() {
  const [credentials, setCredentials] = useState({
    username: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [awaitingWorkspace, setAwaitingWorkspace] = useState(false);
  const { login, user, sessionExpired, isLoading: authLoading } = useAuth();
  const { hasPermission, roles, permissions, error: permissionsError, isLoading: permissionsLoading } = useOpsPermissions();
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  // ПРИЧИНА, ПО КОТОРОЙ ЧЕЛОВЕК ЗДЕСЬ (Plane №383). Провайдер сессии уводит
  // сюда с `?reason=expired`, когда продлить токен не удалось. Без этой
  // строки выход после восьми часов работы читается как «система выкинула ни
  // с того ни с сего» — а сказать нам есть что.
  //
  // Отдельно от `error` формы: то — ответ на попытку входа, это — состояние,
  // с которым человек пришёл, и первая же неудачная попытка входа обязана
  // заменить его своим сообщением, а не спорить с ним рядом.
  const expired = (sessionExpired || searchParams.get("reason") === "expired") && error === "";

  useEffect(() => {
    if (!sessionExpired || !awaitingWorkspace) return;
    setAwaitingWorkspace(false);
    setIsLoading(false);
  }, [awaitingWorkspace, sessionExpired]);

  // Вошедшему форма входа не нужна: он попадал на неё по прямой ссылке на «/»
  // и видел приглашение залогиниться поверх уже живой сессии.
  useEffect(() => {
    if (user === null || user === undefined) return;
    const callbackUrl = safeCallbackUrl(searchParams.get("callbackUrl"));
    if (callbackUrl !== null) {
      router.replace(callbackUrl);
      return;
    }
    // Права приходят отдельным запросом. До него маршрут не выбираем:
    // «/dashboard» без `orgstructure.view` показывал человеку отказ сразу
    // после успешного входа.
    if (!permissionsLoading && !permissionsError && permissions !== undefined) {
      router.replace(PORTAL_HOME_PATH);
    }
  }, [hasPermission, roles, permissions, permissionsError, permissionsLoading, router, searchParams, user]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    let loginSucceeded = false;

    try {
      const success = await login(credentials.username, credentials.password);

      if (success) {
        // Маршрут выбирает эффект выше, когда получены права раздела. Редирект
        // здесь опережал этот запрос и всегда уводил на недоступный «Обзор».
        setAwaitingWorkspace(true);
        loginSucceeded = true;
      } else {
        setError("Неверное имя пользователя или пароль");
      }
    } catch (err) {
      console.error("Login error:", err);

      let errorMessage = "Произошла ошибка при входе в систему";

      if (err instanceof Error) {
        if (err.message.includes("500")) {
          errorMessage =
            "Ошибка сервера (500). Проверьте правильность данных или обратитесь к администратору";
        } else if (err.message.includes("404")) {
          errorMessage = "Сервис авторизации недоступен (404)";
        } else if (err.message.includes("401") || err.message.includes("403")) {
          errorMessage = "Неверное имя пользователя или пароль";
        } else {
          errorMessage = err.message;
        }
      }

      setError(errorMessage);
    } finally {
      if (!loginSucceeded) setIsLoading(false);
    }
  };

  if (!sessionExpired && (awaitingWorkspace || authLoading || (user !== null && user !== undefined))) {
    return (
      <div className="sj-visual sj-login min-h-screen flex items-center justify-center p-6">
        {permissionsError ? (
          <div role="alert" className="max-w-md space-y-3 text-center">
            <p className="font-medium">Не удалось загрузить доступные разделы</p>
            <p className="text-sm text-muted-foreground">Вход выполнен. Повторите загрузку, чтобы открыть рабочее пространство.</p>
            <Button onClick={() => void queryClient.resetQueries({ queryKey: ["ops-me"], exact: true })}>
              Повторить загрузку
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {awaitingWorkspace || user !== null ? "Открываем рабочее пространство…" : "Проверяем сессию…"}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="sj-visual sj-login">
      <Card className="sj-login-card">
        <CardHeader className="sj-login-header">
          <div className="sj-brand-mark" aria-hidden="true">SJ</div>
          <p className="sj-login-eyebrow">SMART JOSPARLAU</p>
          <CardTitle className="sj-login-title"><h1>Вход в систему</h1></CardTitle>
          <CardDescription>Введите данные вашей LAN-учётной записи.</CardDescription>
        </CardHeader>
        <CardContent className="sj-login-content">
          <form onSubmit={handleLogin} className="sj-login-form">
            <div className="sj-login-field">
              <Label htmlFor="username">Имя пользователя</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                placeholder="Введите имя пользователя"
                value={credentials.username}
                onChange={(e) => setCredentials((prev) => ({ ...prev, username: e.target.value }))}
                required
              />
            </div>
            <div className="sj-login-field">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Введите пароль"
                value={credentials.password}
                onChange={(e) => setCredentials((prev) => ({ ...prev, password: e.target.value }))}
                required
              />
            </div>
            {expired && (
              <Alert className="border-primary/40 bg-primary/5 text-left">
                <AlertCircle className="h-4 w-4 text-primary-ink" />
                <AlertDescription className="text-foreground">Сессия истекла — войдите заново.</AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="sj-login-submit" disabled={isLoading}>
              {isLoading ? "Вход..." : "Войти"}
            </Button>
          </form>
          <p className="sj-login-footer">Закрытый контур · Smart Josparlau</p>
        </CardContent>
      </Card>
    </div>
  );
}
