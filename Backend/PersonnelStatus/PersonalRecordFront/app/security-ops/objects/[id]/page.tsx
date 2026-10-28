"use client";

// Published passport data and dated inspections have separate lifecycles.
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Building2 } from "lucide-react";
import { useToast } from "@/shared/hooks/use-toast";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  useSecurityObject,
  useSecurityObjects,
  useUploadObjectPhoto,
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
import {
  PassportForm,
  PassportVersionsPanel,
} from "@/features/object-passport";
import { DutyForcesSection } from "@/features/object-duty-forces";
import { ObjectInspectionsPanel } from "@/features/object-passport/ui/ObjectInspectionsPanel";
import { PASSPORT_TABS as TABS, passportTab, type PassportTab as TabCode } from "@/features/object-passport/model/inspections";

const DEFAULT_TAB: TabCode = "general";

export default function SecurityObjectPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <SecurityObjectScreen />
    </Suspense>
  );
}

function SecurityObjectScreen() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const access = useOpsPermissions();
  const { hasPermission, isLoading: permissionsLoading } = access;
  const canView = !permissionsLoading && access.permissions !== undefined && hasPermission("object.view");
  const query = useSecurityObject(id, { enabled: canView });
  // Свежесть и «чего нет» приезжают ТОЛЬКО с конвертом реестра — у карточки
  // своей ручки под них нет. Ключ запроса тот же, что у реестра, поэтому
  // переход из списка ничего не догружает, а прямой заход по адресу берёт
  // конверт один раз. Своего срока карточка не считает: дни до проверки уже
  // посчитала политика на сервере.
  const registry = useSecurityObjects({ enabled: canView });

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Возврат — на тот же отбор, с которым человек ушёл (параметр `back`).
  const back = searchParams.get("back") ?? "";
  const backTo = back === "" ? "/security-ops/objects" : `/security-ops/objects?${back}`;
  const tabParam = searchParams.get("tab");
  const tab: TabCode = passportTab(tabParam);
  // Счётчик собственных сохранений паспорта: см. комментарий у key ниже.
  const [formGeneration, setFormGeneration] = useState(0);

  const freshness: PassportFreshness | undefined = useMemo(
    () => registry.data?.freshness.find((item) => item.objectId === id),
    [registry.data, id]
  );
  const unavailableKpi: UnavailableMetric[] = registry.data?.unavailableKpi ?? [];
  // Та же граница, что у PATCH и POST /passport/ на сервере: object.view открывает
  // карточку, object.manage — только её мутирующие контролы.
  const canManagePassport = hasPermission("object.manage");
  const accessReadFailed = query.readAccessBlocked;
  const showPassport = canView && query.data?.id === id && !accessReadFailed;
  // An access loss closes this form instance. Its late mutation must not
  // publish cached data or reset a newly opened form for the same object.
  const passportContext = useMemo(() => ({}), [id, showPassport, canManagePassport]);
  const currentContext = useRef(passportContext);
  const mounted = useRef(false);
  currentContext.current = passportContext;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const isCurrentResult = () => mounted.current && currentContext.current === passportContext && showPassport;

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
  if (permissionsLoading) {
    return <DashboardLayout><p className="text-sm text-muted-foreground">Проверка доступа к паспорту…</p></DashboardLayout>;
  }
  if (!canView) {
    return <OpsAccessDenied what="паспорта объекта" />;
  }

  if (query.isLoading) {
    return (
      <DashboardLayout>
        <p className="text-sm text-muted-foreground">Загрузка объекта…</p>
      </DashboardLayout>
    );
  }
  if (!showPassport || query.data === undefined) {
    return (
      <DashboardLayout>
        <LoadFailure
          what="паспорт объекта"
          description={accessReadFailed ? "Объект не найден или недоступен для просмотра." :
            query.data !== undefined && query.data.id !== id ? "Ответ не соответствует выбранному объекту. Повторите загрузку." : undefined}
          onRetry={() => { void query.refetch(); }}
          isRetrying={query.isFetching}
        />
        <Link
          href={backTo}
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
        href={backTo}
        className="mb-3 inline-block text-xs font-semibold text-primary-ink"
      >
        ← Назад к реестру
      </Link>

      {query.isError && (
        <LoadFailure what="паспорт объекта"
          description="Показаны последние загруженные данные. Черновики сохранены; повторите загрузку для проверки актуальности."
          onRetry={() => { void query.refetch(); }} isRetrying={query.isFetching} />
      )}

      <PassportHeader
        object={object}
        freshness={freshness}
        canUploadPhoto={hasPermission("object.manage")}
      />

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
          <DutyForcesSection key={`${object.id}:${searchParams.get('dutyDate') ?? ''}`} objectId={object.id} initialDate={searchParams.get('dutyDate') ?? undefined} />
        </>
      )}

      {/* Макет по прототипу — плейсхолдер-структура, без своего состояния,
          поэтому размонтирование ей не вредит. `hidden`, а не условный
          рендер, здесь ради ЕДИНООБРАЗИЯ с формой постов ниже: обе новые
          вкладки, добавленные этой задачей, не должны молча заменить
          проверенный способ прятать «Посты и секторы» на конкурирующий. */}

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
          key={`posts-${object.id}-${formGeneration}`}
          objectId={object.id}
          sectors={object.sectors}
          canEdit={canManagePassport}
          onSaved={() => setFormGeneration((value) => value + 1)}
          isCurrentResult={isCurrentResult}
        />
      </div>

      <div hidden={tab !== "check"}>
        <ObjectInspectionsPanel objectId={object.id} active={tab === "check"} />
      </div>

      {/* Сверка постов и чужое обновление объекта сохраняют черновик
          публикации. Поля сбрасывает только собственный успешный POST. */}
      <div hidden={tab !== "history"}>
        <PassportVersionsPanel
          key={`versions-${object.id}`}
          objectId={object.id}
          versions={object.passportVersions}
          objectName={object.name}
          isActive={tab === "history"}
          readFailure={query.isError ? { onRetry: () => { void query.refetch(); }, isRetrying: query.isFetching } : undefined}
          backToRegistry={back}
          hasPosts={object.sectors.some((sector) => sector.posts.length > 0)}
          canPublish={canManagePassport}
          isCurrentResult={isCurrentResult}
        />
      </div>

      {unavailableKpi.length > 0 && <details className="mt-4 text-sm"><summary className="cursor-pointer text-muted-foreground">Ограничения показателей</summary><MissingSection unavailableKpi={unavailableKpi} /></details>}
    </DashboardLayout>
  );
}

function PassportHeader({
  object,
  freshness,
  canUploadPhoto,
}: {
  object: SecurityObject;
  freshness: PassportFreshness | undefined;
  canUploadPhoto: boolean;
}) {
  const { toast } = useToast();
  const uploadPhoto = useUploadObjectPhoto();

  function pickPhoto(file: File | undefined): void {
    if (file === undefined) return;
    uploadPhoto.mutate(
      { id: object.id, file },
      {
        onSuccess: () => toast({ description: "Снимок объекта загружен" }),
        onError: (error: unknown) => {
          const message =
            typeof error === "object" && error !== null && "message" in error
              ? String((error as { message: unknown }).message)
              : "";
          toast({
            title: "Снимок не загружен",
            description:
              message === "" ? "Сервис временно недоступен. Попробуйте ещё раз." : message,
            variant: "destructive",
          });
        },
      }
    );
  }

  return (
    <Card className="mb-4">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row">
        {/* Снимок объекта-каталога (Plane SJ-1049, «в стиле Модуля ОЛ») —
            та же плашка-плейсхолдер, что карточка охраняемого лица
            (`app/security-ops/persons/page.tsx`): квадрат `bg-muted` с
            иконкой, пока снимка нет. Действие загрузки показываем только с
            `object.manage`; сервер повторно проверяет это право при
            сохранении. */}
        <div className="flex items-center gap-3 sm:flex-col sm:gap-1.5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[16px] bg-muted text-muted-foreground sm:h-24 sm:w-24">
            {object.photoUrl !== null ? (
              // eslint-disable-next-line @next/next/no-img-element -- снимок объекта — произвольный URL медиа-хранилища, не оптимизируемый актив сборки.
              <img src={object.photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Building2 className="h-8 w-8" aria-hidden="true" />
            )}
          </div>
          {canUploadPhoto && (
            <label className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-primary-ink hover:underline">
              {uploadPhoto.isPending
                ? "Загрузка…"
                : object.photoUrl !== null
                  ? "Заменить снимок"
                  : "Загрузить снимок"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={uploadPhoto.isPending}
                aria-label={`Снимок объекта ${object.name}`}
                onChange={(e) => {
                  pickPhoto(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
        <div className="min-w-0 flex-1">
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
          <PageHeader
            eyebrow="Объекты"
            title={object.name}
            description={`${object.type} · ${object.region} · ${object.address}`}
          />
        </div>
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
            ? `Срок обновления паспорта — ${freshness.verificationDueAt}. `
            : ""}
          Проверьте посты и секторы и при необходимости опубликуйте новую версию.
          Результаты обследования ведутся отдельно.
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
      "Срок обновления паспорта",
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
          Основные сведения и актуальность опубликованного паспорта. Обследования ведутся отдельно.
        </p>
      </CardHeader>
      <CardContent>
        <dl className="divide-y">
          {rows.map(([key, value]) => (
            <div
              key={key}
              className="grid grid-cols-1 gap-1 py-2.5 text-sm sm:grid-cols-[minmax(9rem,14rem)_1fr] sm:gap-3"
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
        <CardTitle>Доступность показателей</CardTitle>
        <p className="text-xs text-muted-foreground">
          Для этих показателей пока недостаточно данных.
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
        </ul>
      </CardContent>
    </Card>
  );
}
