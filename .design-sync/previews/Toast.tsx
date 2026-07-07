import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "my-v0-project";

export const Open = () => (
  <ToastProvider swipeDirection="right">
    <Toast open>
      <div className="grid gap-1">
        <ToastTitle>Статус обновлён</ToastTitle>
        <ToastDescription>
          Ахметов А. Б. — «Командировка» с 05.07.2026 (приказ №215-к).
        </ToastDescription>
      </div>
      <ToastAction altText="Отменить изменение статуса">Отменить</ToastAction>
      <ToastClose style={{ opacity: 1 }} />
    </Toast>
    {/* position:static — иначе fixed-вьюпорт уезжает из кадра карточки */}
    <ToastViewport style={{ position: "static", maxWidth: "100%" }} />
  </ToastProvider>
);
