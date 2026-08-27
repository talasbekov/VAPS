"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  updateProfile,
  changePassword,
  ProfileApiError,
} from "../api/edit-profile-api";

interface EditProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Ошибки, привязанные к полям запроса: `{ new_password: "…" }`. */
type FieldErrors = Record<string, string>;

/**
 * Первое сообщение по каждому полю.
 *
 * Показывается ОДНО, а не все: под полем пароля их приходит до четырёх сразу
 * (короткий, распространённый, только цифры, похож на логин), и столбик из
 * четырёх строк раздвигает форму так, что кнопка уезжает за край диалога.
 * Остальные человек увидит следующей попыткой — исправлять их всё равно по
 * одной.
 */
function firstPerField(error: unknown): FieldErrors {
  if (!(error instanceof ProfileApiError)) return {};
  return Object.fromEntries(
    Object.entries(error.fieldErrors)
      .filter(([, messages]) => messages.length > 0)
      .map(([field, messages]) => [field, messages[0]])
  );
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function EditProfileDialog({
  open,
  onOpenChange,
}: EditProfileDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState<null | "profile" | "password">(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState<string | null>(null);

  // Данные профиля
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");

  // Пароль
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Подставляем данные профиля при открытии — и только один раз на открытие.
  // Объект user пересоздаётся на каждом обновлении сессии NextAuth (в том
  // числе фоновом, по возвращении фокуса на вкладку), поэтому засев по
  // изменению user затирал бы уже введённые имя и почту.
  const seededRef = useRef(false);

  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current || !user) return;
    seededRef.current = true;
    const nameParts = user.name?.split(" ") || [];
    setFirstName(nameParts[0] || "");
    setLastName(nameParts.slice(1).join(" ") || "");
    setEmail(user.email || "");
  }, [open, user]);

  const startAttempt = () => {
    setError(null);
    setFieldErrors({});
    setSuccess(null);
  };

  /**
   * Показать отказ: ошибки — под своими полями, шапка — про остальное.
   *
   * Шапка НЕ повторяет дословно то, что уже стоит под полем: на снимке стенда
   * «Текущий пароль неверен.» читалось дважды подряд в двух сантиметрах друг
   * от друга и выглядело сбоем, а не подсказкой. Но и молчать она не может —
   * тот, кто читает экран не глазами, узнаёт об отказе именно из неё (у неё
   * role="alert"), поэтому вместо дубля она отправляет к полям.
   */
  const showFailure = (err: unknown, fallback: string) => {
    const perField = firstPerField(err);
    setFieldErrors(perField);
    const count = Object.keys(perField).length;
    if (count === 0) {
      setError(messageOf(err, fallback));
    } else {
      setError(
        count === 1
          ? "Проверьте выделенное поле."
          : "Проверьте выделенные поля."
      );
    }
  };

  const handleSaveProfile = async () => {
    startAttempt();
    setLoading("profile");

    try {
      await updateProfile({
        first_name: firstName,
        last_name: lastName,
        email: email,
      });

      setSuccess("Профиль успешно обновлен");
      setTimeout(() => {
        onOpenChange(false);
        setSuccess(null);
        // Обновляем страницу для отображения новых данных
        window.location.reload();
      }, 2000);
    } catch (err) {
      showFailure(err, "Ошибка при обновлении профиля");
    } finally {
      setLoading(null);
    }
  };

  const handleChangePassword = async () => {
    startAttempt();

    // Проверки, которые сервер сделать не может: он получает ОДИН пароль, а
    // подтверждение существует ровно затем, чтобы человек не закрепил
    // опечатку. Пустые поля тоже отбиваются здесь — за ними нет вопроса к
    // серверу.
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Заполните все поля для смены пароля");
      setFieldErrors({
        ...(currentPassword ? {} : { current_password: "Введите текущий пароль" }),
        ...(newPassword ? {} : { new_password: "Введите новый пароль" }),
        ...(confirmPassword
          ? {}
          : { confirm_password: "Повторите новый пароль" }),
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Новые пароли не совпадают");
      setFieldErrors({ confirm_password: "Пароли не совпадают" });
      return;
    }

    setLoading("password");

    try {
      await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });

      // Поля очищаются сразу: набранный пароль больше не нужен, а оставленный
      // в форме он переживёт закрытие диалога вместе с остальным состоянием.
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Пароль изменён. Он понадобится при следующем входе.");
    } catch (err) {
      showFailure(err, "Ошибка при смене пароля");
    } finally {
      setLoading(null);
    }
  };

  const busy = loading !== null;

  /** Подпись ошибки под полем — она же цель `aria-describedby` этого поля. */
  const FieldError = ({ field }: { field: string }) =>
    fieldErrors[field] ? (
      <p id={`${field}-error`} className="text-sm text-destructive">
        {fieldErrors[field]}
      </p>
    ) : null;

  /** Разметка поля с ошибкой: подсветка рамки и связь с подписью. */
  const fieldProps = (field: string) => ({
    "aria-invalid": Boolean(fieldErrors[field]),
    "aria-describedby": fieldErrors[field] ? `${field}-error` : undefined,
    className: cn(fieldErrors[field] && "border-destructive"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Редактировать профиль</DialogTitle>
          <DialogDescription>
            Измените данные профиля или пароль
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Сообщения об ошибках/успехе. role=alert — чтобы отказ дошёл и до
              того, кто читает экран не глазами: без него смена пароля молча
              не происходила бы. */}
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="border-green-200 bg-green-50" role="status">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                {success}
              </AlertDescription>
            </Alert>
          )}

          {/* Данные профиля */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Личные данные</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">Имя</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Имя"
                  {...fieldProps("first_name")}
                />
                <FieldError field="first_name" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lastName">Фамилия</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Фамилия"
                  {...fieldProps("last_name")}
                />
                <FieldError field="last_name" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                {...fieldProps("email")}
              />
              <FieldError field="email" />
            </div>

            <Button
              onClick={handleSaveProfile}
              disabled={busy}
              className="w-full"
            >
              {loading === "profile" && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Сохранить изменения
            </Button>
          </div>

          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-4">Смена пароля</h3>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Текущий пароль</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Введите текущий пароль"
                  {...fieldProps("current_password")}
                />
                <FieldError field="current_password" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="newPassword">Новый пароль</Label>
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Введите новый пароль (минимум 8 символов)"
                  {...fieldProps("new_password")}
                />
                <FieldError field="new_password" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Подтвердите новый пароль</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Повторите новый пароль"
                  {...fieldProps("confirm_password")}
                />
                <FieldError field="confirm_password" />
              </div>

              <Button
                onClick={handleChangePassword}
                disabled={busy}
                variant="outline"
                className="w-full"
              >
                {loading === "password" && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Изменить пароль
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
