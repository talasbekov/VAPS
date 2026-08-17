"use client";

// Паспорт объекта по экрану прототипа Smart Josparlau (`Прототип/Объекты.dc.html`,
// экран `scrPass`, строки 127–312).
//
// Прототип держит здесь шесть вкладок. Перенесены ТРИ — те, под которыми есть
// живой источник: «Общие данные» (поля объекта + свежесть проверки из конверта
// реестра), «Посты и секторы» (действующая редакция паспорта) и «История»
// (опубликованные версии). Остальные три — «Инфраструктура», «Чек-лист» и
// «Привлекаемые группы» — не нарисованы вовсе и названы внизу экрана: пустая
// вкладка читалась бы как «данные есть, просто их ноль».
//
// Экран НИЧЕГО не считает сам. Состояние паспорта, срок проверки, политику
// свежести и снимки версий присылает сервер; страница только раскладывает их
// по вкладкам и печатает его же словами.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  useSecurityObject,
  useSecurityObjects,
} from "@/hooks/use-security-objects";
import {
  FRESHNESS_LABEL,
  OBJECT_STATE_LABEL,
  OWNERSHIP_LABEL,
  PASSPORT_STATE_LABEL,
  PassportStateBadge,
} from "@/entities/security-object";
import type {
  PassportFreshness,
  SecurityObject,
  UnavailableMetric,
} from "@/entities/security-object";
import { PassportForm, PassportVersionsPanel } from "@/features/object-passport";
import { DutyForcesSection } from "@/features/object-duty-forces";

const TABS = [
  { code: "general", label: "Общие данные" },
  { code: "posts", label: "Посты и секторы" },
  { code: "history", label: "История" },
] as const;

type TabCode = (typeof TABS)[number]["code"];

const DEFAULT_TAB: TabCode = "general";

function isTab(value: string | null): value is TabCode {
  return TABS.some((tab) => tab.code === value);
}

/**
 * Чего в паспорте нет и почему. Две первые строки — СЛОВАМИ СЕРВЕРА
 * (`unavailableKpi` конверта реестра), остальные принадлежат этому экрану:
 * вкладок прототипа сервер не знает, называть их за него было бы подлогом.
 */
const MISSING_TABS: ReadonlyArray<{ title: string; reason: string }> = [
  {
    title: "Вкладка «Инфраструктура»",
    reason:
      "Входы и выходы, транспорт, вертикальные коммуникации, инженерные системы, уязвимые места и ремонтные работы моделью не хранятся вовсе — ни таблицы, ни ручки.",
  },
  {
    title: "Вкладка «Чек-лист» и прохождение проверки",
    reason:
      "Контрольных вопросов, ответов «да/нет/не применимо» и решения по расчёту постов в бэке нет. Дата проверки, которую показывает шапка, считается политикой свежести от последней ПУБЛИКАЦИИ, а не от пройденного чек-листа.",
  },
  {
    title: "Вкладка «Привлекаемые группы»",
    reason:
      "Кинологическая группа, ГБР, инженерно-сапёрная и им подобные не заведены: привлекаемые силы живут в мероприятии, у объекта их списка нет.",
  },
  {
    title: "«Мероприятия и инциденты» во вкладке «История»",
    reason:
      "История паспорта — это его опубликованные версии. Построчного журнала правок и ленты мероприятий по объекту сервер не отдаёт; лента ОМ живёт в реестре мероприятий.",
  },
  {
    title: "«Старший объекта», тип поста и предельное время без смены",
    reason:
      "У объекта нет поля ответственного, а у поста — типа (наружный/внутренний) и предельного времени без смены: пост несёт имя, задачу и требования.",
  },
];

export default function SecurityObjectPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const query = useSecurityObject(id);
  // Свежесть и «чего нет» приезжают ТОЛЬКО с конвертом реестра — у карточки
  // своей ручки под них нет. Ключ запроса тот же, что у реестра, поэтому
  // переход из списка ничего не догружает, а прямой заход по адресу берёт
  // конверт один раз. Своего срока карточка не считает: дни до проверки уже
  // посчитала политика на сервере.
  const registry = useSecurityObjects();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: TabCode = isTab(tabParam) ? tabParam : DEFAULT_TAB;
  // Счётчик собственных сохранений паспорта: см. комментарий у key ниже.
  const [formGeneration, setFormGeneration] = useState(0);

  const freshness: PassportFreshness | undefined = useMemo(
    () => registry.data?.freshness.find((item) => item.objectId === id),
    [registry.data, id]
  );
  const unavailableKpi: UnavailableMetric[] = registry.data?.unavailableKpi ?? [];
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  function pickTab(next: TabCode): void {
    const params = new URLSearchParams(searchParams);
    // Умолчание в адрес не пишется: `?tab=general` и голый адрес — одно и то
    // же состояние, и две записи истории на один экран путали бы «назад».
    if (next === DEFAULT_TAB) params.delete("tab");
    else params.set("tab", next);
    const queryString = params.toString();
    router.replace(queryString === "" ? pathname : `${pathname}?${queryString}`);
  }

  // Тот же код, что у реестра объектов: паспорт открывается прямой ссылкой в
  // обход реестра, и без гварда отказ по правам выглядел как «объект не найден».
  if (!permissionsLoading && !hasPermission("object.view")) {
    return <OpsAccessDenied what="паспорта объекта" />;
  }

  if (query.isLoading) {
    return (
      <DashboardLayout>
        <p className="text-sm text-muted-foreground">Загрузка объекта…</p>
      </DashboardLayout>
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <DashboardLayout>
        <p className="text-sm text-destructive-ink">Объект не найден или недоступен.</p>
        <Link
          href="/security-ops/objects"
          className="mt-2 inline-block text-sm font-semibold text-primary-ink"
        >
          ← Назад к реестру
        </Link>
      </DashboardLayout>
    );
  }

  const object = query.data;

  return (
    <DashboardLayout>
      <Link
        href="/security-ops/objects"
        className="mb-3 inline-block text-xs font-semibold text-primary-ink"
      >
        ← Назад к реестру
      </Link>

      <PassportHeader object={object} freshness={freshness} />

      <PassportAlert object={object} freshness={freshness} />

      <nav
        role="tablist"
        aria-label="Разделы паспорта"
        className="mb-4 flex gap-1 overflow-x-auto border-b"
      >
        {TABS.map((item) => {
          const active = item.code === tab;
          return (
            <button
              key={item.code}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => pickTab(item.code)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                active
                  ? "border-primary text-primary-ink"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {tab === "general" && (
        <>
          <GeneralTab object={object} freshness={freshness} />
          <DutyForcesSection objectId={object.id} />
        </>
      )}

      {/* Форма НЕ снимается при уходе на другую вкладку, а прячется:
          несохранённый черновик живёт в её собственном состоянии, и
          размонтирование стирало бы набранное молча — человек вернулся бы на
          вкладку и увидел прежние посты, ничего об этом не узнав.
          Ключ монтирования — счётчик СВОИХ сохранений, а не updatedAt: по
          updatedAt форму пересобирал любой фоновый рефетч, принёсший чужую
          правку, — вместе с несохранённым черновиком. Ключ это идентичность,
          а не версия данных. */}
      <div hidden={tab !== "posts"}>
        <PassportForm
          key={`posts-${formGeneration}`}
          objectId={object.id}
          sectors={object.sectors}
          onSaved={() => setFormGeneration((value) => value + 1)}
        />
      </div>

      {tab === "history" && (
        <PassportVersionsPanel
          key={`versions-${object.updatedAt}`}
          objectId={object.id}
          versions={object.passportVersions}
          hasPosts={object.sectors.some((sector) => sector.posts.length > 0)}
        />
      )}

      <MissingSection unavailableKpi={unavailableKpi} />
    </DashboardLayout>
  );
}

function PassportHeader({
  object,
  freshness,
}: {
  object: SecurityObject;
  freshness: PassportFreshness | undefined;
}) {
  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold">
            {object.code}
          </span>
          <PassportStateBadge state={object.passportState} />
          {freshness !== undefined && (
            <span className="text-[11px] text-muted-foreground">
              {FRESHNESS_LABEL[freshness.state]}
            </span>
          )}
        </div>
        <h1 className="text-xl font-bold">{object.name}</h1>
        <p className="text-sm text-muted-foreground">
          {object.type} · {object.region} · {object.address}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Баннер прототипа «Паспорт не готов». У прототипа под ним — СПИСОК
 * незаполненных полей; здесь его нет и не будет: сервер отдаёт состояние
 * паспорта целиком (RED/YELLOW/GREEN), а из чего оно сложилось — не
 * сообщает. Перечислять поля своей догадкой значило бы отправить человека
 * заполнять не то.
 */
function PassportAlert({
  object,
  freshness,
}: {
  object: SecurityObject;
  freshness: PassportFreshness | undefined;
}) {
  const stale =
    freshness?.state === "OVERDUE" || freshness?.state === "NO_PUBLISHED_VERSION";
  if (object.passportState === "GREEN" && !stale) return null;

  return (
    <div
      role="status"
      className="mb-4 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <AlertTriangle className="h-5 w-5 shrink-0" />
      <div className="text-sm">
        <p className="font-semibold">
          Паспорт: {PASSPORT_STATE_LABEL[object.passportState]}
          {freshness !== undefined && ` · ${FRESHNESS_LABEL[freshness.state]}`}
        </p>
        <p className="text-xs">
          {freshness?.verificationDueAt !== undefined &&
          freshness.verificationDueAt !== null
            ? `Срок очередной проверки — ${freshness.verificationDueAt}. `
            : ""}
          Какие именно поля не заполнены, сервер не сообщает — он отдаёт
          состояние паспорта целиком.
        </p>
      </div>
    </div>
  );
}

function GeneralTab({
  object,
  freshness,
}: {
  object: SecurityObject;
  freshness: PassportFreshness | undefined;
}) {
  const rows: ReadonlyArray<[string, string]> = [
    ["Название", object.name],
    ["Регистрационный №", object.code],
    ["Тип", object.type],
    ["Регион", object.region],
    ["Адрес", object.address],
    ["Принадлежность", OWNERSHIP_LABEL[object.ownership]],
    ["Состояние объекта", OBJECT_STATE_LABEL[object.objectState]],
    ["Статус паспорта", PASSPORT_STATE_LABEL[object.passportState]],
    [
      "Срок проверки",
      freshness?.verificationDueAt ?? "не назначен: паспорт не публиковался",
    ],
    [
      "Актуальность",
      freshness === undefined ? "—" : FRESHNESS_LABEL[freshness.state],
    ],
    ["Есть охранные мероприятия", object.hasSecurityEvents ? "да" : "нет"],
  ];

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Общие данные</CardTitle>
        <p className="text-xs text-muted-foreground">
          Поля объекта и срок проверки — как их отдал сервер
        </p>
      </CardHeader>
      <CardContent>
        <dl className="divide-y">
          {rows.map(([key, value]) => (
            <div
              key={key}
              className="grid grid-cols-[minmax(9rem,14rem)_1fr] gap-3 py-2.5 text-sm"
            >
              <dt className="text-xs text-muted-foreground">{key}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function MissingSection({
  unavailableKpi,
}: {
  unavailableKpi: UnavailableMetric[];
}) {
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Чего в этом паспорте нет</CardTitle>
        <p className="text-xs text-muted-foreground">
          Блоки прототипа, которым не нашлось живого источника
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3 text-sm">
          {unavailableKpi.map((item) => (
            <li key={item.code}>
              <span className="font-semibold">{item.label}</span>
              <p className="text-xs text-muted-foreground">{item.reason}</p>
            </li>
          ))}
          {MISSING_TABS.map((item) => (
            <li key={item.title}>
              <span className="font-semibold">{item.title}</span>
              <p className="text-xs text-muted-foreground">{item.reason}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
