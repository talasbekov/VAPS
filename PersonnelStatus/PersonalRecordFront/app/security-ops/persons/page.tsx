"use client";

// Охраняемые лица: каталог профилей с делением «Наши / Иностранные».
//
// Связи «лицо → мероприятия» в данных ОМ не существует: у SecurityEvent нет
// ссылки на охраняемое лицо. Единственное место, где лицо названо рядом с
// мероприятием, — сводка ГВО, поэтому обе кнопки карточки собирают ответ
// оттуда (по совпадению ФИО) и честно говорят, когда совпадений нет. В
// прототипе на их месте стоял тост-заглушка «Показаны мероприятия…».
import { useState } from "react";
import Link from "next/link";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useSecurityEvents } from "@/hooks/use-security-events";
import { useGvoPatches, patchesByCode } from "@/hooks/use-gvo-summaries";
import { useProtectedPersons } from "@/hooks/use-protected-persons";
import {
  PROTECTED_PERSON_CATEGORIES,
  PROTECTED_PERSON_CATEGORY_LABEL,
} from "@/entities/protected-person";
import type {
  ProtectedPerson,
  ProtectedPersonCategory,
} from "@/entities/protected-person";
import { deriveGvoSummary, mergeGvoSummary } from "@/entities/gvo-summary";
import type { SecurityEvent } from "@/entities/security-event";

// Реестр ОМ читается целиком: связь с лицом ищется по сводкам, а не запросом
// с фильтром — фильтровать по охраняемому лицу бэк не умеет.
const PAGE_SIZE = 200;

// Однострочная константа, а не текст прямо в JSX (тот же приём, что и у
// PERSONS_REGISTRY_GAP_LINE на карточке ГВО, entities/gvo-summary): e2e пинит
// её ДОСЛОВНО (см. e2e/protected-persons.spec.ts), а JSX схлопывает переносы
// строк по своим правилам.
const EVENTS_LINK_GAP_LINE =
  "связь по совпадению имени в сводках ГВО; прямой ссылки в модели нет (бэк-этап)";

type Disclosure = { personId: string; kind: "events" | "objects" } | null;

export default function ProtectedPersonsPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const [category, setCategory] = useState<ProtectedPersonCategory>("OURS");
  const [disclosure, setDisclosure] = useState<Disclosure>(null);

  const canView = hasPermission("event.view");
  const personsQuery = useProtectedPersons({ enabled: canView });
  const eventsQuery = useSecurityEvents(
    { search: "", stage: "ALL", from: "", to: "", owner: "", page: 1, pageSize: PAGE_SIZE },
    { enabled: canView }
  );
  const patchesQuery = useGvoPatches({ enabled: canView });

  if (!permissionsLoading && !canView) {
    return <OpsAccessDenied what="каталога охраняемых лиц" />;
  }

  const patches = patchesByCode(patchesQuery.data);
  const events = eventsQuery.data?.results ?? [];
  const persons = (personsQuery.data?.results ?? []).filter(
    (person) => person.category === category
  );

  /** Мероприятия, в сводке ГВО которых названо это лицо. */
  function eventsOf(person: ProtectedPerson): SecurityEvent[] {
    const needle = person.name.trim().toLowerCase();
    return events.filter((event) => {
      const summary = mergeGvoSummary(deriveGvoSummary(event), patches[event.code]);
      return summary.persons.some(
        (item) => item.name.trim().toLowerCase() === needle
      );
    });
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Оперативная работа"
          title="Охраняемые лица"
          description="Профили лиц, в отношении которых организуются охранные мероприятия"
        />

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

        {personsQuery.isLoading ? (
          <Card>
            <CardContent className="p-9 text-center text-sm text-muted-foreground">
              Загрузка каталога…
            </CardContent>
          </Card>
        ) : personsQuery.isError ? (
          <Card>
            <CardContent className="p-9 text-center text-sm text-destructive-ink">
              Не удалось загрузить каталог охраняемых лиц.
            </CardContent>
          </Card>
        ) : persons.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            В этой категории пока нет охраняемых лиц.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {persons.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                events={eventsOf(person)}
                isLoadingLinks={eventsQuery.isLoading || patchesQuery.isLoading}
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
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function PersonCard({
  person,
  events,
  isLoadingLinks,
  disclosure,
  onDisclose,
}: {
  person: ProtectedPerson;
  events: SecurityEvent[];
  isLoadingLinks: boolean;
  disclosure: "events" | "objects" | null;
  onDisclose: (kind: "events" | "objects") => void;
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
        <div className="flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-[16px] bg-muted text-[12px] text-muted-foreground shadow-[0_10px_24px_hsl(221.2_83.2%_53.3%_/_.15)]">
          Фото
        </div>
        <div className="min-w-56 flex-1">
          <div className="flex flex-wrap items-center gap-[10px]">
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
          <p className="mt-[9px] max-w-[640px] text-[12.5px] leading-[1.55] text-muted-foreground">
            {person.bio}
          </p>
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
        </div>
      </div>

      {disclosure !== null && (
        <div className="mt-4 border-t pt-3">
          <PersonLinks
            person={person}
            events={events}
            kind={disclosure}
            isLoading={isLoadingLinks}
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
  isLoading,
}: {
  person: ProtectedPerson;
  events: SecurityEvent[];
  kind: "events" | "objects";
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <p className="text-[12.5px] text-muted-foreground">Загрузка реестра ОМ…</p>
    );
  }
  // Блок «Мероприятия с участием» — только у панели событий: подпись честно
  // называет, ЧТО именно за связь показана, и остаётся на месте и когда
  // совпадений нет (пустое состояние ниже), и когда они есть — блок никогда
  // не бывает голым.
  const heading = kind === "events" && (
    <div className="mb-2">
      <h3 className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        Мероприятия с участием
      </h3>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        {EVENTS_LINK_GAP_LINE}
      </p>
    </div>
  );
  if (events.length === 0) {
    return (
      <>
        {heading}
        <p className="text-[12.5px] text-muted-foreground">
          {person.name} не назван ни в одной сводке ГВО — связанных мероприятий и
          объектов нет.
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
  // Объект у ОМ один — снимок имени; уникализируем, чтобы повторы визитов на
  // тот же объект не размножали строки.
  const objects = Array.from(
    new Map(
      events.map((event) => [event.objectId ?? event.objectName, event])
    ).values()
  );
  return (
    <ul className="space-y-1">
      {objects.map((event) => (
        <li key={event.objectId ?? event.objectName} className="text-[12.5px]">
          {event.objectId === null ? (
            <span className="font-semibold">{event.objectName}</span>
          ) : (
            <Link
              href={`/security-ops/objects/${event.objectId}`}
              className="font-semibold text-primary-ink"
            >
              {event.objectName}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
