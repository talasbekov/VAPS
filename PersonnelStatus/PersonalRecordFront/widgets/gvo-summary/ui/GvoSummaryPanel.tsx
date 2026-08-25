"use client";

// Сводные данные ГВО по одному ОМ — ПАНЕЛЬ, а не экран (Plane «Реестр ОМ-35.4»).
//
// Заказчик убирает модуль «Реестр ГВО»: функционал сводки переходит
// мероприятию и открывается кнопкой «Информация по ГВО» в карточке ОМ. Поэтому
// разметка живёт здесь, а не в странице: два хоста (свой экран сводки и
// карточка мероприятия) рисуют ОДНО И ТО ЖЕ, и копия на четыреста строк
// разошлась бы с оригиналом на первой же правке.
//
// Своей записи у сводки нет: она собирается из бюллетеня (deriveGvoSummary) и
// патча ручных правок, поэтому «черновик» — не состояние документа, а
// отсутствие правок.
import { useState } from "react";
import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useGvoPatches, patchesByCode } from "@/hooks/use-gvo-summaries";
import { StageBadge } from "@/entities/security-event";
import type { SecurityEvent } from "@/entities/security-event";
import { GvoSectionDialog, GvoVisitsDialog } from "@/features/gvo-section-edit";
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { usePersonnelMe } from "@/hooks/use-security-event-stages";
import {
  canManageGvoSummary,
  deriveGvoSummary,
  gvoCountryAbbr,
  gvoStaffCount,
  isGvoSummaryFilled,
  mergeGvoSummary,
  UNSPECIFIED,
} from "@/entities/gvo-summary";
import type { GvoFlight, GvoSection } from "@/entities/gvo-summary";

// Однострочная константа, а не текст прямо в JSX: e2e пинит её ДОСЛОВНО
// (см. e2e/gvo-sections.spec.ts), а JSX схлопывает переносы строк по своим
// правилам — рисковать переносами там, где важен точный текст, незачем.
export const PERSONS_REGISTRY_GAP_LINE =
  "С реестром «Охраняемые лица» эти карточки не связаны — модель ГВО хранит только текст бюллетеня, без ссылки на запись каталога; появится бэк-этапом.";

export interface GvoSummaryPanelProps {
  event: SecurityEvent;
  /**
   * `page` — свой экран сводки: шапка несёт код ОМ, этап и H1 «Сводные
   * данные». `embedded` — панель в карточке мероприятия: код и этап там уже
   * стоят выше, а H1 страницы занят названием мероприятия.
   */
  variant?: "page" | "embedded";
}

export function GvoSummaryPanel({
  event,
  variant = "page",
}: GvoSummaryPanelProps) {
  const { hasPermission } = useOpsPermissions();
  // Правка сводки — своё право (Plane «Реестр ОМ-35.6»): `gvo.manage` либо
  // старший ЭТОГО мероприятия. Кадровая запись учётки нужна именно для второй
  // половины: связь «учётка → сотрудник» существует только на сервере.
  const me = usePersonnelMe();
  const canEdit = canManageGvoSummary({
    hasPermission,
    myEmployeeId: me.data?.id ?? null,
    event,
  });
  const [section, setSection] = useState<GvoSection | null>(null);
  // Объекты посещения правятся своим окном, а не разделом патча («Реестр
  // ОМ-35.1»): список объектов принадлежит мероприятию.
  const [visitsOpen, setVisitsOpen] = useState(false);
  const patchesQuery = useGvoPatches({ enabled: true });

  if (patchesQuery.isLoading) {
    return (
      <Card>
        <CardContent className="p-9 text-center text-sm text-muted-foreground">
          Загрузка сводных данных…
        </CardContent>
      </Card>
    );
  }

  const patch = patchesByCode(patchesQuery.data)[event.code];
  const summary = mergeGvoSummary(deriveGvoSummary(event), patch);
  const filled = isGvoSummaryFilled(patch);
  const staff = gvoStaffCount(summary);
  const edit = canEdit ? (next: GvoSection) => () => setSection(next) : null;

  return (
    <>
      <div className="space-y-3">
        {/* Шапка */}
        <Card>
          <CardContent className="flex flex-wrap items-start gap-4 p-[17px]">
            {/* bg-muted, а не хардкод hsl(210 40% 96.1%) из прототипа — тот же
                баг, что и у трёх карточек ниже (Task 9, fix round 1): без
                override под тёмную тему текст (без явного цвета →
                text-foreground, в тёмной теме почти белый) читался белым по
                белому. data-testid — для регрессии тёмной темы в e2e. */}
            <div
              data-testid="gvo-country-abbr"
              className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[11px] border bg-muted text-[14px] font-extrabold"
            >
              {gvoCountryAbbr(summary.country)}
            </div>
            <div className="min-w-56 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {/* Код ОМ и этап — только на своём экране: в карточке
                    мероприятия они уже стоят в её шапке, и второй раз тем же
                    текстом ловят substring-пробы других экранов в
                    неоднозначность. */}
                {variant === "page" && (
                  <>
                    <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[10.5px] font-bold text-purple-800">
                      {event.code}
                    </span>
                    <StageBadge stage={event.stage} />
                  </>
                )}
                <span
                  className={
                    filled
                      ? "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800"
                      : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                  }
                >
                  {filled ? "Сводка заполнена" : "Черновик сводки"}
                </span>
              </div>
              {/* Надзаголовок не передаём: над H1 уже стоит ряд бейджей (код
                  ОМ, этап, состояние сводки) — он и есть контекст записи.
                  Второй капсовый лейбл сверху дублировал бы его. */}
              {/* В панели мероприятия H1 страницы занят названием ОМ, и
                  второй H1 внутри неё сломал бы порядок заголовков: там
                  подпись идёт строкой, а не заголовком страницы. */}
              {variant === "page" ? (
                <PageHeader
                  className="mt-1"
                  title="Сводные данные"
                  description={`${event.title} · ${summary.country} · ${summary.arrival.date} — ${summary.departure.date}`}
                />
              ) : (
                <>
                  {/* Подпись, а не H1: заголовок страницы занят названием
                      мероприятия. Но и совсем без неё блок пустел — в шапке
                      панели оставались только плашка страны и счётчик
                      состава, и полоса между ними читалась как обрыв
                      вёрстки. */}
                  <p className="mt-1 text-[14px] font-semibold">
                    Сводные данные ГВО
                  </p>
                  <p className="text-[12.5px] text-muted-foreground">
                    {summary.country} · {summary.arrival.date} —{" "}
                    {summary.departure.date}
                  </p>
                </>
              )}
            </div>
            <div className="text-right">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Состав ГВО СГО РК
              </p>
              <p className="text-[18px] font-bold tabular-nums">
                {staff > 0 ? `${staff} чел.` : UNSPECIFIED}
              </p>
              {edit !== null && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1 h-9"
                  onClick={edit("head")}
                >
                  <Pencil className="mr-1 h-[13px] w-[13px]" aria-hidden />
                  Страна
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Охраняемые лица */}
        <Section
          title="Охраняемые лица"
          action={
            edit !== null && (
              <div className="flex flex-wrap items-center gap-2">
                {/* Правка раздела целиком нужна не только для массовой вставки:
                    удалив последнее лицо, вернуть раздел к исходным данным
                    было бы больше нечем — кнопки на карточке лица не осталось. */}
                <EditButton onClick={edit("persons")} label="Изменить список охраняемых лиц" />
                <Button variant="outline" size="sm" className="h-[30px]" onClick={edit("person:new")}>
                  ＋ Добавить лицо
                </Button>
              </div>
            )
          }
        >
          {summary.persons.length === 0 ? (
            <EmptyBox text="Охраняемые лица не указаны в бюллетене" />
          ) : (
            <div className="space-y-3">
              {summary.persons.map((person, index) => (
                <div
                  key={`${person.name}-${index}`}
                  className="flex flex-wrap gap-4 rounded-[12px] border p-[14px]"
                >
                  {/* bg-muted вместо того же хардкода (fix round 1): текст тут
                      уже themed (text-muted-foreground), поэтому баг был
                      Minor — контраст деградировал, но не исчезал целиком. */}
                  <div className="flex h-[196px] w-[150px] shrink-0 items-center justify-center rounded-[12px] bg-muted text-[12px] text-muted-foreground shadow-[0_8px_22px_rgba(16,24,40,.10)]">
                    Фото ОЛ
                  </div>
                  <div className="min-w-56 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                          Лицо {index + 1}
                        </p>
                        <p className="text-[17px] font-bold tracking-[-0.01em]">
                          {person.name}
                        </p>
                        <p className="text-[12.5px] text-muted-foreground">
                          {person.role}
                        </p>
                      </div>
                      {edit !== null && (
                        <EditButton
                          onClick={edit(`person:${index}` as GvoSection)}
                          label={`Изменить данные лица ${index + 1}`}
                        />
                      )}
                    </div>
                    <div className="mt-3 grid gap-px bg-[hsl(210_40%_94%)] [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
                      {person.facts.map((fact) => (
                        <div key={fact.key} className="bg-card px-3 py-2">
                          <p className="text-[10.5px] font-semibold text-muted-foreground">
                            {fact.key}
                          </p>
                          <p className="text-[12.5px] [text-wrap:pretty]">
                            {fact.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Честная подпись — ПОД списком, как у «Руководства департамента»
              и у вкладок паспорта объекта (ревью ветки 22.08: здесь она одна
              стояла НАД содержимым и читалась как заголовок раздела, а не как
              оговорка о нём). */}
          <p className="mt-3 text-xs text-muted-foreground">
            {PERSONS_REGISTRY_GAP_LINE}
          </p>
        </Section>

        {/* Борта */}
        <div className="grid gap-[14px] [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          <FlightCard
            title="Прибытие / тип борта"
            flight={summary.arrival}
            listTitle="Встречают"
            list={summary.meet}
            onEdit={edit === null ? null : edit("arrival")}
          />
          <FlightCard
            title="Убытие / тип борта"
            flight={summary.departure}
            listTitle="Провожают"
            list={summary.farewell}
            onEdit={edit === null ? null : edit("departure")}
          />
        </div>

        {/* Организация */}
        <Section
          title="Организация"
          action={edit !== null && <EditButton onClick={edit("org")} label="Изменить организацию" />}
        >
          <div className="grid gap-[10px] [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
            {(
              [
                ["Место проживания", summary.stay.place],
                ["Номер проживания", summary.stay.room],
                ["Руководитель СБ", summary.sbChief],
                ["Вооружение", summary.weapons],
                ["Вариант ОБ", summary.obVariant],
                ["Канал р/связи", summary.radio],
                ["Пожелания", summary.wishes],
              ] as const
            ).map(([key, value]) => (
              <div
                key={key}
                // bg-muted, а не хардкод hsl(210 40% 98%) из прототипа: тот
                // не переопределён под тёмную тему, и текст значения (без
                // явного цвета, значит text-foreground) на нём становился
                // белым по белому — нечитаемо. bg-muted инвертируется темой,
                // тон в светлой теме почти не отличим (96% против 98%).
                className="rounded-[8px] border bg-muted px-3 py-[10px]"
              >
                <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  {key}
                </p>
                <p className="text-[12.5px] font-semibold [text-wrap:pretty]">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-[14px] border-t pt-[14px]">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Состав делегации
            </p>
            <ul className="mt-1 list-disc pl-4 text-[12.5px]">
              {(summary.delegation.length > 0
                ? summary.delegation
                : [UNSPECIFIED]
              ).map((line, index) => (
                <li key={`${line}-${index}`}>{line}</li>
              ))}
            </ul>
          </div>
        </Section>

        {/* Состав ГВО */}
        <Section
          title="Состав ГВО СГО РК"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-muted-foreground">
                Ответственный:{" "}
                <span className="font-semibold text-foreground">
                  {summary.responsible === null
                    ? UNSPECIFIED
                    : `${summary.responsible.name} · позывной ${summary.responsible.callsign} — ${summary.responsible.role}`}
                </span>
              </span>
              {edit !== null && (
                <>
                  {/* Тот же довод, что и у охраняемых лиц: после удаления
                      последней группы вернуть раздел к исходным можно только
                      отсюда. */}
                  <EditButton onClick={edit("groups")} label="Изменить состав ГВО" />
                  <Button variant="outline" size="sm" className="h-[30px]" onClick={edit("resp")}>
                    Ответственный
                  </Button>
                  <Button variant="outline" size="sm" className="h-[30px]" onClick={edit("group:new")}>
                    ＋ Группа
                  </Button>
                </>
              )}
            </div>
          }
        >
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(330px,1fr))]">
            {summary.groups.map((group, index) => (
              <div key={`${group.name}-${index}`} className="overflow-hidden rounded-[10px] border">
                {/* bg-muted вместо хардкода прототипа: тот не переопределён
                    под тёмную тему, и имя группы (без явного цвета) на нём
                    было белым по белому. */}
                <div className="flex items-center gap-2 bg-muted px-3 py-2">
                  <span className="text-[12.5px] font-bold">{group.name}</span>
                  <span className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold">
                    {group.members.length > 0
                      ? `${group.members.length} чел.`
                      : UNSPECIFIED}
                  </span>
                  {edit !== null && (
                    <span className="ml-auto">
                      <EditButton
                        small
                        onClick={edit(`group:${index}` as GvoSection)}
                        label={`Изменить группу ${group.name}`}
                      />
                    </span>
                  )}
                </div>
                {group.members.length === 0 ? (
                  <p className="px-3 py-3 text-[12px] text-muted-foreground">
                    Состав не назначен
                  </p>
                ) : (
                  <Table>
                    <TableBody>
                      {group.members.map((member, memberIndex) => (
                        <TableRow
                          key={`${member.name}-${memberIndex}`}
                          className="border-t border-[hsl(210_40%_96%)]"
                        >
                          <TableCell className="w-2/5 font-semibold">
                            {member.name}
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {member.callsign}
                          </TableCell>
                          <TableCell className="whitespace-normal text-muted-foreground">
                            {member.role}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            ))}
          </div>
        </Section>

        {/* Транспорт */}
        <Section
          title="Выделяемый транспорт"
          action={
            edit !== null && <EditButton onClick={edit("transport")} label="Изменить транспорт" />
          }
        >
          {summary.transport.length === 0 ? (
            <EmptyBox text="Транспорт не выделен" />
          ) : (
            <div className="space-y-2">
              {summary.transport.map((row, index) => (
                <div
                  key={`${row.code}-${index}`}
                  className="flex flex-wrap items-center gap-[11px] rounded-[9px] border border-[hsl(210_40%_94%)] px-3 py-[9px]"
                >
                  <span className="rounded-[7px] bg-[hsl(222.2_47.4%_11.2%)] px-[10px] py-[3px] text-[11px] font-extrabold text-white">
                    {row.code}
                  </span>
                  <span className="text-[12.5px] font-semibold">{row.car}</span>
                  <span className="text-[11.5px] text-muted-foreground">{row.note}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Объекты посещения */}
        <Section
          title="Объекты посещения"
          action={
            canEdit && (
              <EditButton
                onClick={() => setVisitsOpen(true)}
                label="Изменить объекты посещения"
              />
            )
          }
        >
          {/* Пусто — у мероприятия НЕ ДОБАВЛЕН ни один объект посещения: с
              «Реестр ОМ-35.1» раздел читает таблицу объектов, и пустой список
              это факт бюллетеня, а не сбой загрузки. Без этой подписи секция
              выглядела бы просто оборванной. */}
          {summary.visits.length === 0 ? (
            <EmptyBox text="Объекты посещения не добавлены в мероприятие" />
          ) : (
          <div className="grid gap-[11px] [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
            {summary.visits.map((visit, index) => (
              <div key={`${visit.day}-${index}`} className="overflow-hidden rounded-[10px] border">
                {/* bg-muted вместо хардкода прототипа: тот не переопределён
                    под тёмную тему, и дата дня (без явного цвета) на нём
                    была белой по белому. */}
                <div className="flex items-baseline justify-between gap-2 bg-muted px-3 py-2">
                  <span className="text-[12.5px] font-bold tabular-nums">{visit.day}</span>
                  <span className="text-[11px] text-muted-foreground">{visit.weekday}</span>
                </div>
                {visit.items.length === 0 ? (
                  <p className="px-3 py-3 text-[12px] text-muted-foreground">
                    Объекты не указаны
                  </p>
                ) : (
                  <div className="grid gap-px bg-[hsl(210_40%_94%)]">
                    {visit.items.map((item, itemIndex) => (
                      <div key={`${item.obj}-${itemIndex}`} className="bg-card px-3 py-2">
                        <p className="text-[12.5px] font-semibold">{item.obj}</p>
                        <p className="text-[11.5px] text-muted-foreground">{item.note}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          )}
        </Section>
      </div>

      {section !== null && (
        <GvoSectionDialog
          omCode={event.code}
          omTitle={event.title}
          section={section}
          summary={summary}
          onClose={() => setSection(null)}
        />
      )}

      {visitsOpen && (
        <GvoVisitsDialog event={event} onClose={() => setVisitsOpen(false)} />
      )}
    </>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-[17px]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13.5px] font-semibold">{title}</h2>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function FlightCard({
  title,
  flight,
  listTitle,
  list,
  onEdit,
}: {
  title: string;
  flight: GvoFlight;
  listTitle: string;
  list: string[];
  onEdit: (() => void) | null;
}) {
  return (
    <Section
      title={title}
      action={onEdit === null ? undefined : <EditButton onClick={onEdit} label={`Изменить: ${title}`} />}
    >
      <p className="text-[19px] font-bold tabular-nums">
        {flight.date}{" "}
        <span className="text-[13px] font-semibold">{flight.time}</span>
      </p>
      <dl className="mt-2 space-y-1">
        {(
          [
            ["Маршрут", flight.route],
            ["Рейс", flight.flight],
            ["В полёте", flight.dur],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="flex gap-2">
            <dt className="w-24 shrink-0 text-[11px] font-semibold text-muted-foreground">
              {key}
            </dt>
            <dd className="text-[12.5px]">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-[14px] border-t pt-[14px]">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          {listTitle}
        </p>
        {list.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-muted-foreground">{UNSPECIFIED}</p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-4 text-[12.5px]">
            {list.map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function EditButton({
  onClick,
  label,
  small = false,
}: {
  onClick: () => void;
  label: string;
  small?: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={label}
      className={small ? "h-7 px-2" : "h-[30px] px-[11px]"}
      onClick={onClick}
    >
      <Pencil className="mr-1 h-[13px] w-[13px]" aria-hidden />
      Изменить
    </Button>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <p className="rounded-[10px] border border-dashed border-[hsl(214.3_31.8%_88%)] px-4 py-6 text-center text-[12.5px] text-muted-foreground">
      {text}
    </p>
  );
}
