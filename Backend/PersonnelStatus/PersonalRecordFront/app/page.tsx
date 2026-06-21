"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
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
import { Building2, Users, Shield, AlertCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const [credentials, setCredentials] = useState({
    username: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [isPointerVisible, setIsPointerVisible] = useState(false);
  const [particles, setParticles] = useState<
    Array<{
      id: number;
      x: number;
      y: number;
      targetX: number;
      targetY: number;
      size: number;
      opacity: number;
      color: string;
    }>
  >([]);
  const { login } = useAuth();
  const router = useRouter();

  // Параллакс-эффект для декоративных элементов
  const [parallaxOffset, setParallaxOffset] = useState({ x: 0, y: 0 });

  // Генерируем начальные частицы
  useEffect(() => {
    const initialParticles = Array.from({ length: 80 }, (_, i) => ({
      id: i,
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      targetX: Math.random() * window.innerWidth,
      targetY: Math.random() * window.innerHeight,
      size: Math.random() * 4 + 0.5,
      opacity: Math.random() * 0.6 + 0.2,
      color: [
        "rgba(59, 130, 246, ",
        "rgba(99, 102, 241, ",
        "rgba(139, 92, 246, ",
        "rgba(96, 165, 250, ",
        "rgba(147, 197, 253, ",
      ][Math.floor(Math.random() * 5)],
    }));
    setParticles(initialParticles);
  }, []);

  // Анимация частиц
  useEffect(() => {
    const interval = setInterval(() => {
      setParticles((prev) =>
        prev.map((particle) => {
          // Плавное движение к целевой позиции
          const dx = particle.targetX - particle.x;
          const dy = particle.targetY - particle.y;
          const newX = particle.x + dx * 0.05;
          const newY = particle.y + dy * 0.05;

          // Если достигли цели, выбираем новую
          const distance = Math.sqrt(dx * dx + dy * dy);
          let newTargetX = particle.targetX;
          let newTargetY = particle.targetY;

          if (distance < 5) {
            newTargetX = Math.random() * window.innerWidth;
            newTargetY = Math.random() * window.innerHeight;
          }

          return {
            ...particle,
            x: newX,
            y: newY,
            targetX: newTargetX,
            targetY: newTargetY,
          };
        })
      );
    }, 50);
    return () => clearInterval(interval);
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setCursorPos({ x, y });
    setIsPointerVisible(true);

    // Параллакс-эффект
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const parallaxX = (x - centerX) / 30;
    const parallaxY = (y - centerY) / 30;
    setParallaxOffset({ x: parallaxX, y: parallaxY });

    // Магнитный эффект — частицы притягиваются к курсору
    setParticles((prev) =>
      prev.map((particle) => {
        const dx = x - particle.x;
        const dy = y - particle.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Если частица близко к курсору, притягиваем её
        if (distance < 200) {
          const force = (200 - distance) / 200;
          return {
            ...particle,
            targetX: particle.x + dx * force * 0.3,
            targetY: particle.y + dy * force * 0.3,
          };
        }

        return particle;
      })
    );
  };

  const handleMouseLeave = () => {
    setIsPointerVisible(false);
    setParallaxOffset({ x: 0, y: 0 });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const success = await login(credentials.username, credentials.password);

      if (success) {
        router.push("/dashboard");
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
      setIsLoading(false);
    }
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Магнитные частицы */}
      {particles.map((particle) => {
        const distanceToCursor = Math.sqrt(
          Math.pow(cursorPos.x - particle.x, 2) +
            Math.pow(cursorPos.y - particle.y, 2)
        );
        const isNearCursor = distanceToCursor < 200 && isPointerVisible;
        const glowIntensity = isNearCursor ? 1 - distanceToCursor / 200 : 0;

        return (
          <div
            key={particle.id}
            className="pointer-events-none absolute rounded-full transition-all duration-300"
            style={{
              left: particle.x,
              top: particle.y,
              width: particle.size + (isNearCursor ? glowIntensity * 4 : 0),
              height: particle.size + (isNearCursor ? glowIntensity * 4 : 0),
              opacity:
                particle.opacity + (isNearCursor ? glowIntensity * 0.5 : 0),
              background: `${particle.color}${particle.opacity})`,
              boxShadow: isNearCursor
                ? `0 0 ${20 * glowIntensity}px ${
                    particle.color
                  }${glowIntensity})`
                : "none",
              transform: "translate(-50%, -50%)",
            }}
          />
        );
      })}

      {/* Мягкое свечение вокруг курсора */}
      <div
        className="pointer-events-none absolute rounded-full transition-opacity duration-500"
        style={{
          left: cursorPos.x,
          top: cursorPos.y,
          width: 400,
          height: 400,
          transform: "translate(-50%, -50%)",
          opacity: isPointerVisible ? 0.3 : 0,
          background:
            "radial-gradient(circle, rgba(99, 102, 241, 0.2), rgba(59, 130, 246, 0.1) 40%, transparent 70%)",
          filter: "blur(40px)",
        }}
      />

      {/* Внутреннее свечение */}
      <div
        className="pointer-events-none absolute rounded-full transition-opacity duration-300"
        style={{
          left: cursorPos.x,
          top: cursorPos.y,
          width: 200,
          height: 200,
          transform: "translate(-50%, -50%)",
          opacity: isPointerVisible ? 0.4 : 0,
          background:
            "radial-gradient(circle, rgba(59, 130, 246, 0.3), rgba(99, 102, 241, 0.2) 40%, transparent 70%)",
          filter: "blur(25px)",
        }}
      />

      {/* Декоративные элементы с параллаксом */}
      <div
        className="pointer-events-none absolute -left-40 -top-40 rounded-full transition-all duration-700 ease-out"
        style={{
          width: 400,
          height: 400,
          transform: `translate(${parallaxOffset.x * 2}px, ${
            parallaxOffset.y * 2
          }px) rotate(${parallaxOffset.x / 2}deg)`,
          background:
            "radial-gradient(circle at 30% 30%, rgba(139, 92, 246, 0.12), rgba(99, 102, 241, 0.08) 40%, transparent 70%)",
          filter: "blur(70px)",
          opacity: 0.8,
        }}
      />
      <div
        className="pointer-events-none absolute -right-32 bottom-0 rounded-full transition-all duration-700 ease-out"
        style={{
          width: 450,
          height: 450,
          transform: `translate(${-parallaxOffset.x * 1.5}px, ${
            -parallaxOffset.y * 1.5
          }px) rotate(${-parallaxOffset.y / 2}deg)`,
          background:
            "radial-gradient(circle at 70% 70%, rgba(59, 130, 246, 0.12), rgba(96, 165, 250, 0.08) 40%, transparent 70%)",
          filter: "blur(70px)",
          opacity: 0.8,
        }}
      />

      <div className="w-full max-w-md relative z-10">
        <div
          className="text-center mb-8 transition-transform duration-500 ease-out animate-fade-in-up"
          style={{
            transform: `translate(${parallaxOffset.x * 0.5}px, ${
              parallaxOffset.y * 0.5
            }px)`,
            animationDelay: "0.1s",
            opacity: 0,
          }}
        >
          <div className="flex items-center justify-center mb-4">
            <div
              className="relative bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 p-4 rounded-3xl shadow-2xl transition-all duration-500 hover:scale-110 hover:shadow-blue-500/50 hover:rotate-6 group cursor-pointer"
              style={{
                transform: `translate(${parallaxOffset.x * 0.8}px, ${
                  parallaxOffset.y * 0.8
                }px)`,
                boxShadow:
                  "0 20px 60px rgba(59, 130, 246, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)",
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent rounded-3xl opacity-0 group-hover:opacity-100 group-hover:animate-shimmer"
                style={{
                  backgroundSize: "200% 100%",
                  animation: "shimmer 2s infinite",
                }}
              />
              <Building2 className="h-9 w-9 text-white relative z-10 drop-shadow-lg transition-transform duration-300 group-hover:scale-110" />
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 mb-2">
            Расход Организации
          </h1>
          <p className="text-gray-600">Система управления персоналом</p>
        </div>

        <Card
          className="shadow-2xl border border-white/20 backdrop-blur-2xl transition-all duration-500 ease-out hover:shadow-[0_40px_80px_rgba(59,130,246,0.4)] hover:scale-[1.02] hover:-translate-y-1.5 hover:border-blue-500/50 animate-fade-in-up overflow-hidden relative group ring-0 hover:ring-4 hover:ring-blue-500/10"
          style={{
            transform: `translate(${parallaxOffset.x * 0.3}px, ${
              parallaxOffset.y * 0.3
            }px)`,
            animationDelay: "0.3s",
            opacity: 0,
            background:
              "linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(255, 255, 255, 0.95) 100%)",
            boxShadow:
              "0 25px 50px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.5)",
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
          <div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-100/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 group-hover:animate-shimmer pointer-events-none"
            style={{
              backgroundSize: "200% 100%",
              animation: "shimmer 2.5s infinite",
            }}
          />

          <CardHeader className="space-y-2 relative z-10 pt-8">
            <CardTitle className="text-2xl text-center font-bold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 bg-clip-text text-transparent">
              Вход в систему
            </CardTitle>
            <CardDescription className="text-center text-gray-600">
              Введите ваши учетные данные для доступа
            </CardDescription>
          </CardHeader>
          <CardContent className="relative z-10 px-8 pb-8">
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <Label
                  htmlFor="username"
                  className="text-gray-700 font-medium text-sm"
                >
                  Имя пользователя
                </Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Введите имя пользователя"
                  value={credentials.username}
                  onChange={(e) =>
                    setCredentials((prev) => ({
                      ...prev,
                      username: e.target.value,
                    }))
                  }
                  className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500/20 transition-all duration-300 bg-gray-50/50 hover:bg-white focus:bg-white"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="password"
                  className="text-gray-700 font-medium text-sm"
                >
                  Пароль
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Введите пароль"
                  value={credentials.password}
                  onChange={(e) =>
                    setCredentials((prev) => ({
                      ...prev,
                      password: e.target.value,
                    }))
                  }
                  className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500/20 transition-all duration-300 bg-gray-50/50 hover:bg-white focus:bg-white"
                  required
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                className="w-full h-11 bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-700 hover:via-blue-600 hover:to-indigo-700 text-white font-semibold shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] relative overflow-hidden group"
                disabled={isLoading}
              >
                <div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 group-hover:animate-shimmer"
                  style={{
                    backgroundSize: "200% 100%",
                  }}
                />
                <span className="relative z-10">
                  {isLoading ? "Вход..." : "Войти"}
                </span>
              </Button>
            </form>
          </CardContent>
        </Card>

        <div
          className="mt-8 grid grid-cols-2 gap-4 text-center transition-transform duration-500 ease-out animate-fade-in-up"
          style={{
            transform: `translate(${parallaxOffset.x * 0.2}px, ${
              parallaxOffset.y * 0.2
            }px)`,
            animationDelay: "0.5s",
            opacity: 0,
          }}
        >
          <div
            className="group relative bg-white/90 backdrop-blur-md rounded-2xl p-5 shadow-lg border border-white/60 transition-all duration-500 hover:bg-white hover:shadow-2xl hover:shadow-blue-500/30 hover:scale-105 hover:-translate-y-2 hover:border-blue-400/50 cursor-pointer overflow-hidden"
            style={{
              transform: `translate(${parallaxOffset.x * -0.3}px, ${
                parallaxOffset.y * -0.3
              }px)`,
              boxShadow:
                "0 10px 30px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.6)",
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-400/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 group-hover:animate-shimmer pointer-events-none"
              style={{
                backgroundSize: "200% 100%",
                animation: "shimmer 2s infinite",
              }}
            />

            <div className="relative z-10 bg-gradient-to-br from-blue-600 to-indigo-600 p-2.5 rounded-xl w-fit mx-auto mb-3 shadow-md group-hover:shadow-blue-500/40 transition-all duration-300 group-hover:scale-110 group-hover:rotate-6">
              <Users className="h-5 w-5 text-white" />
            </div>
            <p className="relative z-10 text-sm font-semibold text-gray-700 group-hover:text-gray-900 transition-colors">
              Управление персоналом
            </p>
          </div>
          <div
            className="group relative bg-white/90 backdrop-blur-md rounded-2xl p-5 shadow-lg border border-white/60 transition-all duration-500 hover:bg-white hover:shadow-2xl hover:shadow-green-500/30 hover:scale-105 hover:-translate-y-2 hover:border-green-400/50 cursor-pointer overflow-hidden"
            style={{
              transform: `translate(${parallaxOffset.x * -0.4}px, ${
                parallaxOffset.y * -0.4
              }px)`,
              boxShadow:
                "0 10px 30px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.6)",
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 to-emerald-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-green-400/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 group-hover:animate-shimmer pointer-events-none"
              style={{
                backgroundSize: "200% 100%",
                animation: "shimmer 2s infinite",
              }}
            />

            <div className="relative z-10 bg-gradient-to-br from-green-600 to-emerald-600 p-2.5 rounded-xl w-fit mx-auto mb-3 shadow-md group-hover:shadow-green-500/40 transition-all duration-300 group-hover:scale-110 group-hover:rotate-6">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <p className="relative z-10 text-sm font-semibold text-gray-700 group-hover:text-gray-900 transition-colors">
              Контроль доступа
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
