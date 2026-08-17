"use client";

// Последний рубеж: ловит падения САМОГО корневого лэйаута (провайдеры,
// шрифты, Toaster). Заменяет собой root layout целиком, поэтому обязан
// рендерить <html>/<body> сам.
//
// Стили — инлайновые, а не Tailwind: globals.css импортируется в
// app/layout.tsx, который на этом рубеже уже не отрисован, и классы токенов
// здесь просто не к чему применить.
import type { ReactElement } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <main
          style={{
            maxWidth: "32rem",
            width: "100%",
            textAlign: "center",
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "0.5rem",
            padding: "1.5rem",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.75rem" }}>
            Приложение не запустилось
          </h1>
          <p
            style={{
              fontSize: "0.875rem",
              color: "#475569",
              margin: "0 0 1.25rem",
            }}
          >
            Произошёл сбой на самом верхнем уровне. Попробуйте повторить;
            если не поможет — перезагрузите страницу и сообщите в поддержку
            {error.digest ? ` код ${error.digest}` : ""}.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: "44px",
              padding: "0 1.25rem",
              fontSize: "0.875rem",
              cursor: "pointer",
              color: "#ffffff",
              background: "#2563eb",
              border: "none",
              borderRadius: "0.375rem",
            }}
          >
            Повторить
          </button>
        </main>
      </body>
    </html>
  );
}
