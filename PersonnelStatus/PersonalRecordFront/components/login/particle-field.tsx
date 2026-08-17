"use client";

// Поле частиц на экране входа.
//
// Что было. 80 частиц жили в React-состоянии и пересчитывались `setInterval`
// каждые 50 мс — ~20 полных ре-рендеров страницы в секунду, постоянно, на
// первом экране приложения. Движение мыши добавляло сверху ещё до ~120
// setState в секунду (магнитный эффект пересобирал весь массив). Каждый такой
// проход перерисовывал и форму входа: поля ввода жили в том же компоненте.
//
// Что стало. Частицы ушли на <canvas> и живут вне React: координаты — в
// обычном массиве, кадры — requestAnimationFrame (браузер сам останавливает
// его на скрытой вкладке), курсор — в ref. Состояние React не меняется ни
// разу за всё время анимации, форма не перерисовывается вовсе.
//
// prefers-reduced-motion: кадр рисуется ОДИН раз и цикл не запускается —
// картинка остаётся, движение исчезает.
import { useEffect, useRef } from "react";

const PARTICLE_COUNT = 80;
const MAGNET_RADIUS = 200;

const COLORS = [
  [59, 130, 246],
  [99, 102, 241],
  [139, 92, 246],
  [96, 165, 250],
  [147, 197, 253],
] as const;

interface Particle {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  size: number;
  opacity: number;
  color: readonly [number, number, number];
}

export function ParticleField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Курсор в ref, а не в состоянии: его читает кадр отрисовки, а не React.
  const cursor = useRef({ x: -9999, y: -9999, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;

    let width = 0;
    let height = 0;
    let particles: Particle[] = [];

    function seed(): void {
      particles = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        targetX: Math.random() * width,
        targetY: Math.random() * height,
        size: Math.random() * 4 + 0.5,
        opacity: Math.random() * 0.6 + 0.2,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      }));
    }

    function resize(): void {
      const element = canvasRef.current;
      if (element === null) return;
      const ratio = window.devicePixelRatio || 1;
      width = element.clientWidth;
      height = element.clientHeight;
      element.width = Math.floor(width * ratio);
      element.height = Math.floor(height * ratio);
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (particles.length === 0) seed();
    }

    function draw(): void {
      context!.clearRect(0, 0, width, height);
      for (const particle of particles) {
        const dxCursor = cursor.current.x - particle.x;
        const dyCursor = cursor.current.y - particle.y;
        const toCursor = Math.hypot(dxCursor, dyCursor);
        const near = cursor.current.active && toCursor < MAGNET_RADIUS;
        const glow = near ? 1 - toCursor / MAGNET_RADIUS : 0;

        const [r, g, b] = particle.color;
        const radius = (particle.size + glow * 4) / 2;
        const alpha = Math.min(1, particle.opacity + glow * 0.5);

        if (glow > 0) {
          context!.shadowBlur = 20 * glow;
          context!.shadowColor = `rgba(${r}, ${g}, ${b}, ${glow})`;
        } else {
          context!.shadowBlur = 0;
        }
        context!.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        context!.beginPath();
        context!.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        context!.fill();
      }
      context!.shadowBlur = 0;
    }

    function step(): void {
      for (const particle of particles) {
        // Магнитный эффект: цель смещается к курсору, само движение — прежнее
        // плавное приближение к цели.
        if (cursor.current.active) {
          const dx = cursor.current.x - particle.x;
          const dy = cursor.current.y - particle.y;
          const distance = Math.hypot(dx, dy);
          if (distance < MAGNET_RADIUS) {
            const force = (MAGNET_RADIUS - distance) / MAGNET_RADIUS;
            particle.targetX = particle.x + dx * force * 0.3;
            particle.targetY = particle.y + dy * force * 0.3;
          }
        }

        const dx = particle.targetX - particle.x;
        const dy = particle.targetY - particle.y;
        particle.x += dx * 0.05;
        particle.y += dy * 0.05;
        if (Math.hypot(dx, dy) < 5) {
          particle.targetX = Math.random() * width;
          particle.targetY = Math.random() * height;
        }
      }
    }

    resize();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    function loop(): void {
      step();
      draw();
      frame = requestAnimationFrame(loop);
    }

    function start(): void {
      cancelAnimationFrame(frame);
      if (reduced.matches) {
        draw();
        return;
      }
      frame = requestAnimationFrame(loop);
    }

    function onPointerMove(event: PointerEvent): void {
      const element = canvasRef.current;
      if (element === null) return;
      const rect = element.getBoundingClientRect();
      cursor.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        active: true,
      };
    }

    function onPointerLeave(): void {
      cursor.current.active = false;
    }

    start();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerleave", onPointerLeave);
    reduced.addEventListener("change", start);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      reduced.removeEventListener("change", start);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      // Декорация: для скринридера её нет, курсор сквозь неё проходит.
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className ?? ""}`}
    />
  );
}
