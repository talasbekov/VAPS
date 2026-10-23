"use client";

// Под-навигация раздела рейтинга: у каждого экрана свой маршрут и своё право
// на бэкенде — sidebar несёт одну точку входа, остальные экраны здесь.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { moduleOpenFor, type ModuleHref } from "@/entities/portal-access";

const LINKS: readonly { href: ModuleHref; label: string }[] = [
  { href: "/security-ops/ratings", label: "Сводка" },
  { href: "/security-ops/ratings/workspace", label: "Оценивание" },
  { href: "/security-ops/ratings/evaluations", label: "Итоговые оценки" },
  { href: "/security-ops/ratings/export", label: "Выгрузка" },
  { href: "/security-ops/ratings/audit", label: "Журнал" },
  { href: "/security-ops/ratings/analytics", label: "Аналитика" },
];

export function RatingsNav() {
  const pathname = usePathname();
  const access = useOpsPermissions();
  if (access.isLoading || access.error || access.permissions === undefined) return null;
  const links = LINKS.filter(link => moduleOpenFor(link.href, access.hasPermission,
    code => access.roles.some(role => role.code === code)));
  if (links.length === 0) return null;
  return (
    <nav className="mb-4 flex flex-wrap gap-2" aria-label="Разделы рейтинга">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={
            pathname === link.href
              ? "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              : "rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          }
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
