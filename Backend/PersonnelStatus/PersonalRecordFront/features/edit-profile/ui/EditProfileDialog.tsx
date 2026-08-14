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
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { updateProfile, changePassword } from "../api/edit-profile-api";

interface EditProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditProfileDialog({
  open,
  onOpenChange,
}: EditProfileDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const handleSaveProfile = async () => {
    setError(null);
    setSuccess(null);
    setLoading(true);

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
    } catch (err: any) {
      setError(err.message || "Ошибка при обновлении профиля");
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    setError(null);
    setSuccess(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Заполните все поля для смены пароля");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Новые пароли не совпадают");
      return;
    }

    if (newPassword.length < 8) {
      setError("Пароль должен содержать минимум 8 символов");
      return;
    }

    setLoading(true);

    try {
      await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });

      setSuccess("Пароль успешно изменен");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      
      setTimeout(() => {
        setSuccess(null);
      }, 2000);
    } catch (err: any) {
      setError(err.message || "Ошибка при смене пароля");
    } finally {
      setLoading(false);
    }
  };

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
          {/* Сообщения об ошибках/успехе */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="border-green-200 bg-green-50">
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
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lastName">Фамилия</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Фамилия"
                />
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
              />
            </div>

            <Button
              onClick={handleSaveProfile}
              disabled={loading}
              className="w-full"
            >
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
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Введите текущий пароль"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="newPassword">Новый пароль</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Введите новый пароль (минимум 8 символов)"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Подтвердите новый пароль</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Повторите новый пароль"
                />
              </div>

              <Button
                onClick={handleChangePassword}
                disabled={loading}
                variant="outline"
                className="w-full"
              >
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








