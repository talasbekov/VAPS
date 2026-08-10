import type React from "react"
import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { Providers } from "@/components/providers"
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-inter",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "Расход Организации - Система управления персоналом",
  description: "Современная система управления персоналом с древовидной структурой организации",
  generator: "v0.app",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru" className={`${inter.variable} ${jetbrainsMono.variable} antialiased`} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
        {/* Toaster монтируется в КОРНЕ, а не в каркасе страницы: раньше он
            стоял только в app/security-ops/layout.tsx, поэтому на хостовых
            страницах `toast()` отрабатывал вхолостую — вызов был, окна не
            появлялось. На /reports/ это прятало причину отказа выгрузки
            («День не сдан»), и нажатие кнопки выглядело как «ничего не
            произошло». Стор тостов — модульный синглтон (use-toast.ts:
            memoryState + listeners), поэтому одного Toaster на всё дерево
            достаточно, а второй давал бы дубли окон. */}
        <Toaster />
      </body>
    </html>
  )
}
