"use client";

// Каталог доступен отдельно от реестра ОМ. Связи читаются по запросу и праву.
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CreatePerson } from "@/features/gvo-section-edit/ui/ProtectedPersonPickDialog";
import { useEffect, useState } from "react";
import Link from "next/link";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { MODULE_PERMISSION } from "@/entities/portal-access";
import { useAllSecurityEvents } from "@/hooks/use-all-security-events";
import { useGvoSummaries, summariesByCode } from "@/hooks/use-gvo-summaries";
import {
  useProtectedPersons,
  usePersonEventHistory,
} from "@/hooks/use-protected-persons";
import { EventHistoryDialog } from "@/features/event-history";
import {
  PROTECTED_PERSON_CATEGORIES,
  PROTECTED_PERSON_CATEGORY_LABEL,
} from "@/entities/protected-person";
import type {
  ProtectedPerson,
  ProtectedPersonCategory,
} from "@/entities/protected-person";

import type { SecurityEvent } from "@/entities/security-event";
import { eventsForProtectedPerson, objectsForProtectedPerson } from "@/entities/protected-person/model/event-links";
import { ProtectedPhoto } from "@/shared/ui/protected-photo";
import { LoadFailure } from "@/components/load-failure";

const EVENTS_LINK_DESCRIPTION =
  "Участие указано в бюллетене, объектах посещения или сводке ГВО.";
const LINKS_ERROR_LINE =
  "Не удалось загрузить связанные мероприятия. Попробуйте открыть список ещё раз.";

type Disclosure = { personId: string; kind: "events" | "objects" } | null;

export default function ProtectedPersonsPage() {
  const { hasPermission, isLoading: permissionsLoading, error: permissionsError } = useOpsPermissions();
  const [editor, setEditor] = useState<ProtectedPerson | "new" | null>(null);
  const [category, setCategory] = useState<ProtectedPersonCategory>("OURS");
  // История открывается по кнопке и грузится только тогда: список закрытых ОМ
  // нужен по запросу, а не всем строкам каталога сразу.
  const [historyFor, setHistoryFor] = useState<ProtectedPerson | null>(null);
  const [disclosure, setDisclosure] = useState<Disclosure>(null);

  // `catalog.view`, а не `event.view` (решение заказчика 28.08.2026,
  // Plane №267): рядовой сотрудник видит каталог охраняемых лиц, не видя
  // реестра мероприятий. Пока экран спрашивал право чтения ОМ, выдать
  // одно без другого было нельзя.
  const canView = hasPermission(MODULE_PERMISSION["/security-ops/persons"]);
  const canViewLinks = canView && hasPermission("event.view");
  const accessReady = !permissionsLoading && permissionsError === null && canView;
  const personsQuery = useProtectedPersons({ enabled: accessReady });
  const accessReadFailed = personsQuery.readAccessBlocked;
  const catalogAvailable = accessReady && personsQuery.data !== undefined && !accessReadFailed;
  const loadLinks = catalogAvailable && canViewLinks && disclosure !== null;
  const eventsQuery = useAllSecurityEvents({ enabled: loadLinks });
  const summariesQuery = useGvoSummaries({ enabled: loadLinks });
  const historyQuery = usePersonEventHistory(catalogAvailable ? historyFor?.id ?? null : null);
  const canManage = catalogAvailable && hasPermission("dictionary.manage");
  useEffect(() => {
    if (!catalogAvailable) { setEditor(null); setHistoryFor(null); setDisclosure(null); }
  }, [catalogAvailable]);

  if (permissionsLoading) return <DashboardLayout><p role="status" className="text-sm text-muted-foreground">Проверка доступа к каталогу…</p></DashboardLayout>;

  if (!permissionsLoading && !canView) {
    return <OpsAccessDenied what="каталога охраняемых лиц" />;
  }

  // Disabling queries does not remove their cached data after permission revocation.
  const summaries = summariesByCode(canViewLinks ? summariesQuery.data : undefined);
  const events = canViewLinks ? eventsQuery.data ?? [] : [];
  const persons = (personsQuery.data?.results ?? []).filter(
    (person) => person.category === category
  );

  function eventsOf(person: ProtectedPerson): SecurityEvent[] {
    return canViewLinks && disclosure?.personId === person.id
      ? eventsForProtectedPerson(person, events, summaries)
      : [];
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Охранные мероприятия"
          title="Охраняемые лица"
          description="Профили лиц, в отношении которых организуются охранные мероприятия"
        />

        {canManage && <Button onClick={() => setEditor("new")}>Добавить охраняемое лицо</Button>}
        <div className="flex gap-2">
          {PROTECTED_PERSON_CATEGORIES.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              aria-pressed={category === value}
              variant={category === value ? "default" : "outline"}
              className="h-[34px] px-4 text-[13px] font-semibold"
              onClick={() => {
                setCategory(value);
                setDisclosure(null);
              }}
            >
              {PROTECTED_PERSON_CATEGORY_LABEL[value]}
            </Button>
          ))}
        </div>

        {personsQuery.isError && <LoadFailure what="каталог охраняемых лиц"
          description={catalogAvailable ? "Показаны последние загруженные данные. Открытый черновик сохранён." : undefined}
          onRetry={() => { void personsQuery.refetch(); }} isRetrying={personsQuery.isFetching} />}
        {personsQuery.isLoading ? (
          <Card>
            <CardContent className="p-9 text-center text-sm text-muted-foreground">
              Загрузка каталога…
            </CardContent>
          </Card>
        ) : !catalogAvailable ? null : persons.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            В этой категории пока нет охраняемых лиц.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {persons.map((person) => (
              <div key={person.id} className="space-y-2">
              {canManage && <Button variant="outline" className="h-auto max-w-full whitespace-normal break-words text-left" onClick={() => setEditor(person)}>Редактировать {person.name}</Button>}
              <PersonCard
                person={person}
                events={eventsOf(person)}
                canViewLinks={canViewLinks}
                isLoadingLinks={loadLinks && (eventsQuery.isPending || summariesQuery.isPending)}
                isErrorLinks={eventsQuery.isError || summariesQuery.isError}
                disclosure={
                  disclosure?.personId === person.id ? disclosure.kind : null
                }
                onDisclose={(kind) =>
                  setDisclosure((current) =>
                    current?.personId === person.id && current.kind === kind
                      ? null
                      : { personId: person.id, kind }
                  )
                }
                onHistory={setHistoryFor}
              />
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={catalogAvailable && editor !== null} onOpenChange={(open) => { if (!open) setEditor(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {catalogAvailable && editor !== null && <CreatePerson key={editor === "new" ? "new" : editor.id} catalog allowed={canManage}
            readFailure={personsQuery.isError ? { onRetry: () => { void personsQuery.refetch(); }, isRetrying: personsQuery.isFetching } : undefined}
            person={editor === "new" ? undefined : editor} onBack={() => setEditor(null)} onCreated={(person) => { setCategory(person.category); setEditor(null); }} />}
        </DialogContent>
      </Dialog>
      <EventHistoryDialog
        open={catalogAvailable && historyFor !== null}
        onClose={() => setHistoryFor(null)}
        subject={historyFor?.name ?? ""}
        relatedLabel="Объекты, которые лицо посетило в этом мероприятии"
        // Пустой список объектов — ФАКТ, а не пропуск: у ОМ, заведённых до
        // появления объектов посещения, лицо названо только в бюллетене.
        relatedEmpty="Объекты посещения у мероприятия не заведены — лицо названо в бюллетене"
        isLoading={historyQuery.isLoading}
        isError={historyQuery.isError}
        onRetry={() => { void historyQuery.refetch(); }}
        isRetrying={historyQuery.isFetching}
        rows={(historyQuery.data?.results ?? []).map((row) => ({
          eventId: row.eventId,
          code: row.code,
          title: row.title,
          businessDate: row.businessDate,
          businessDateEnd: row.businessDateEnd,
          closedAt: row.closedAt,
          chiefName: row.chiefName,
          related: row.objects.map((item) => ({
            key: item.visitObjectId,
            label: item.objectName,
            note: [
              item.visitDay === null ? "" : `день ${item.visitDay}`,
              item.note,
            ]
              .filter((part) => part !== "")
              .join(" · "),
          })),
        }))}
      />
    </DashboardLayout>
  );
}

function PersonCard({
  person,
  events,
  canViewLinks,
  isLoadingLinks,
  isErrorLinks,
  disclosure,
  onDisclose,
  onHistory,
}: {
  person: ProtectedPerson;
  events: SecurityEvent[];
  canViewLinks: boolean;
  isLoadingLinks: boolean;
  isErrorLinks: boolean;
  disclosure: "events" | "objects" | null;
  onDisclose: (kind: "events" | "objects") => void;
  onHistory: (person: ProtectedPerson) => void;
}) {
  return (
    /* from-card, а не хардкод from-white из прототипа: тот же приём, что
       profile/page.tsx уже использует (bg-gradient-to-br from-card via-card
       to-primary/10) — токен инвертируется под тёмную тему (в тёмной теме
       --card тон темнее полотна), а from-white оставался белым патчем на
       тёмном фоне (Task 10, дельта-скрин). В светлой теме визуально не
       меняется: --card в светлой теме = 0 0% 100%, то есть тот же белый. */
    <article className="rounded-[14px] border bg-gradient-to-br from-card from-55% to-primary/[0.06] px-[22px] py-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
      <div className="flex flex-wrap items-center gap-[22px]">
        {/* bg-muted, а не хардкод hsl(210 40% 96.1%) из прототипа — тот же
            баг-класс, что Task 9 нашла на карточке ГВО (плашка страны, фото
            ОЛ): без override под тёмную тему текст (text-muted-foreground,
            в тёмной теме почти белый) читался почти белым по почти белому. */}
        <div className="relative flex h-[104px] w-[104px] shrink-0 items-center justify-center overflow-hidden rounded-[16px] bg-muted text-[12px] text-muted-foreground shadow-[0_10px_24px_hsl(221.2_83.2%_53.3%_/_.15)]">
          <span aria-hidden="true">{person.photoUrl ? "Фото недоступно" : "Нет фото"}</span>
          <ProtectedPhoto url={person.photoUrl} alt={person.name} className="absolute inset-0 h-full w-full object-cover" />
        </div>
        <div className="min-w-56 flex-1">
          <div className="flex flex-wrap items-center gap-[10px]">
            {/* Код `OL-N` (Plane №417) — тот, что печатается в бюллетене;
                стоит перед именем, как код ОМ в реестре. */}
            <span
              className="rounded-[20px] bg-primary/10 px-[10px] py-1 font-mono text-[10.5px] font-bold tabular-nums text-primary"
              data-testid={`person-code-${person.id}`}
            >
              {person.code}
            </span>
            <h2 className="text-[19px] font-bold tracking-[-0.01em]">
              {person.name}
            </h2>
            {/* text-secondary-foreground, а не хардкод hsl(215.4 16.3% 36.9%)
                из прототипа — тот же приём, что profile/page.tsx уже
                использует для bg-secondary-плашек: токен инвертируется под
                тёмную тему, хардкод — нет. */}
            <span className="rounded-[20px] bg-secondary px-[10px] py-1 text-[10.5px] font-semibold text-secondary-foreground">
              Позывной «{person.callsign}»
            </span>
          </div>
          {/* Должность и страна (Plane №952) — те же данные, что сводка ГВО
              подставляет при выборе лица; здесь их видно до выбора. */}
          {(person.position !== "" || person.country !== "") && (
            <p className="mt-[6px] text-[12.5px] font-medium" data-testid={`person-profile-${person.id}`}>
              {[person.position, person.country].filter((part) => part !== "").join(" · ")}
            </p>
          )}
          <p className="mt-[9px] max-w-[640px] text-[12.5px] leading-[1.55] text-muted-foreground">
            {person.bio}
          </p>
          {person.facts.length > 0 && (
            <dl className="mt-2 grid max-w-[640px] gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
              {person.facts.map((fact) => (
                <div key={fact.key} className="flex gap-1.5">
                  <dt className="shrink-0 text-muted-foreground">{fact.key}:</dt>
                  <dd className="min-w-0">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="hidden w-px self-stretch bg-border md:block" />
        <div className="flex shrink-0 flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-expanded={disclosure === "events"}
            className="h-[34px] whitespace-nowrap px-4 text-[12px] font-medium"
            onClick={() => onDisclose("events")}
          >
            Все мероприятия с ОЛ
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={disclosure === "objects"}
            className="h-[34px] whitespace-nowrap px-4 text-[12px] font-medium"
            onClick={() => onDisclose("objects")}
          >
            Объекты ОЛ
          </Button>
          {/* История — ЗАКРЫТЫЕ мероприятия лица с объектами, которые он лично
              посетил (задача заказчика Plane №38). Отдельно от «Все
              мероприятия с ОЛ»: та кнопка показывает действующие связи, эта —
              то, что уже случилось. */}
          <Button
            variant="outline"
            size="sm"
            className="h-[34px] whitespace-nowrap px-4 text-[12px] font-medium"
            onClick={() => onHistory(person)}
          >
            История
          </Button>
        </div>
      </div>

      {disclosure !== null && (
        <div className="mt-4 border-t pt-3">
          <PersonLinks
            person={person}
            events={events}
            canView={canViewLinks}
            kind={disclosure}
            isLoading={isLoadingLinks}
            isError={isErrorLinks}
          />
        </div>
      )}
    </article>
  );
}

function PersonLinks({
  person,
  events,
  kind,
  canView,
  isLoading,
  isError,
}: {
  person: ProtectedPerson;
  events: SecurityEvent[];
  kind: "events" | "objects";
  canView: boolean;
  isLoading: boolean;
  isError: boolean;
}) {
  // Keep context visible while loading or retrying an authorized selection.
  const heading = kind === "events" && (
    <div className="mb-2">
      <h3 className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        Мероприятия с участием
      </h3>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        {EVENTS_LINK_DESCRIPTION}
      </p>
    </div>
  );
  if (!canView) {
    return <p className="text-[12.5px] text-muted-foreground">Для просмотра связанных мероприятий нужно право «Просмотр мероприятий». Каталог и история лица доступны отдельно.</p>;
  }
  if (isLoading) {
    return (
      <>
        {heading}
        <p className="text-[12.5px] text-muted-foreground">Загрузка реестра ОМ…</p>
      </>
    );
  }
  // A failed page must not be presented as an empty set of related events.
  if (isError) {
    return (
      <>
        {heading}
        <p className="text-[12.5px] text-muted-foreground">{LINKS_ERROR_LINE}</p>
      </>
    );
  }
  if (events.length === 0) {
    return (
      <>
        {heading}
        <p className="text-[12.5px] text-muted-foreground">
          Связанные мероприятия не найдены.
        </p>
      </>
    );
  }
  if (kind === "events") {
    return (
      <>
        {heading}
        <ul className="space-y-1">
          {events.map((event) => (
            <li key={event.id} className="text-[12.5px]">
              <Link
                href={`/security-ops/events/${event.id}`}
                className="font-semibold text-primary-ink"
              >
                {event.code}
              </Link>{" "}
              <span className="text-muted-foreground">
                {event.title} · {event.businessDate}
              </span>
            </li>
          ))}
        </ul>
      </>
    );
  }
  const objects = objectsForProtectedPerson(person, events);
  if (objects.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground">Мероприятия найдены, но связь лица с конкретными объектами посещения не указана.</p>;
  }
  return (
    <ul className="space-y-1">
      {objects.map((object) => (
        <li key={object.id === null ? `name:${object.name}` : `id:${object.id}`} className="text-[12.5px]">
          {object.id === null ? (
            <span className="font-semibold">{object.name}</span>
          ) : (
            <Link
              href={`/security-ops/objects/${object.id}`}
              className="font-semibold text-primary-ink"
            >
              {object.name}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
