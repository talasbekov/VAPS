"use client";

import { useEffect } from "react";
import Link from "next/link";
import "./not-found.css";

export default function NotFound() {
  useEffect(() => {
    const bg = document.querySelector(".notfound-bg");
    const okak = document.querySelector(".notfound-okak");
    const n404 = document.querySelector(".notfound-404");
    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 40; // диапазон -20..20
      const y = (e.clientY / window.innerHeight - 0.5) * 20; // диапазон -10..10
      if (bg) {
        (bg as HTMLElement).style.backgroundPosition = `${50 + x}% ${50 + y}%`;
      }
      if (okak) {
        (okak as HTMLElement).style.transform = `rotate(7deg) translate(${
          x * 1.5
        }px, ${y * 1.2}px) scale(1.05)`;
      }
      if (n404) {
        (n404 as HTMLElement).style.transform = `rotate(-8deg) translate(${
          -x * 1.2
        }px, ${-y * 1.1}px)`;
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <div className="notfound-bg" style={{ backgroundImage: `url(/okak.jpeg)` }}>
      <div className="notfound-overlay" />
      <h1 className="notfound-404">404</h1>
      <div className="notfound-okak">окак</div>
      <div className="notfound-meme">
        Мы не знаем, в чем проблема, но обязательно ее устраним!
      </div>
      <div className="notfound-emoji" title="Мяу!">
        🐾
      </div>
      <Link href="/" className="notfound-btn">
        На главную
      </Link>
    </div>
  );
}
