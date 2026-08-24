"use client";

// Этап 1 «Бюллетень»: описание и первичные задачи направлениям. Пустой
// бюллетень не завершается — следующему этапу не с чем работать.
//
// Сверено с экраном прототипа Smart Josparlau «Информационный бюллетень».
// Оттуда перенесены готовность этапа (до этого о том, что завершение упрётся
// в пустое поле, узнавали по отказу сервера ПОСЛЕ нажатия) и справочный блок
// «Сведения об ОМ» — паспортная шапка мероприятия перед его описанием.
//
// Блок пересекается с шапкой карточки (номер, объект, ответственный) и это
// осознанно: шапка — строка-идентификатор на все девять этапов, блок —
// сведения, по которым бюллетень и составляют. Расходиться им не на чем:
// оба поля читают один и тот же объект события, второго источника нет.
//
// СОЗНАТЕЛЬНО не перенесено:
// * «Редактировать ОМ» — правки названия, даты и объекта бэк не принимает:
//   PATCH этапа принимает только описание и задачи;
// * «Документы к подготовке» — в прототипе эта таблица набрана литералом
//   (две строки прямо в разметке). Модели документов с ответственными и
//   сроками нет ни у бэка, ни в контракте, и выдумывать её на экране нельзя.
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useCompleteBulletin,
  useUpdateBulletin,
} from "@/hooks/use-security-event-stages";
import { useSecurityObject } from "@/hooks/use-security-objects";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  SECURITY_EVENT_KIND_LABEL,
  STAGE_LABEL,
} from "@/entities/security-event";
import { objectLabel } from "@/entities/security-event";
import type { SecurityEvent } from "@/entities/security-event";
import { daySpanInclusive, ruDate, ruDaysLabel, ruWeekdayName } from "@/lib/ru-date";
import { useGvoPatches, patchesByCode } from "@/hooks/use-gvo-summaries";
import {
  UNSPECIFIED,
  deriveGvoSummary,
  gvoSenior,
  gvoStaffCount,
  mergeGvoSummary,
} from "@/entities/gvo-summary";
import { Fact } from "./Fact";
import { FieldErrors, StageError } from "./StageErrors";

export function BulletinStage({ event }: { event: SecurityEvent }) {
  const [briefDescription, setBriefDescription] = useState(event.briefDescription);
  const [initialTasks, setInitialTasks] = useState(event.initialTasks);
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );

  const update = useUpdateBulletin(event.id, {
    onFormError: (details) => setFieldErrors(details),
  });
  const complete = useCompleteBulletin(event.id);

  const dirty =
    briefDescription !== event.briefDescription ||
    initialTasks !== event.initialTasks;

  // Готовность считается по СОХРАНЁННОМУ бюллетеню, а не по полям формы:
  // сервер смотрит на своё состояние, и набранный, но не сохранённый текст
  // этап не откроет.
  const savedBrief = event.briefDescription.trim() !== "";
  const savedTasks = event.initialTasks.trim() !== "";
  const ready = savedBrief && savedTasks;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Бюллетень</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <EventFacts event={event} />
        <div className="space-y-1">
          <Label htmlFor="bulletin-brief">Краткое описание *</Label>
          <Textarea
            id="bulletin-brief"
            value={briefDescription}
            onChange={(e) => setBriefDescription(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="bulletin-tasks">Первичные задачи направлениям *</Label>
          <Textarea
            id="bulletin-tasks"
            value={initialTasks}
            onChange={(e) => setInitialTasks(e.target.value)}
          />
        </div>
        {/* Кнопка завершения НЕ блокируется по этим признакам: правило
            «описание и задачи заполнены» держит сервер, и второй гард рядом
            маскировал бы его отказ. Здесь только видимое состояние. */}
        <div className="rounded-md border px-3 py-2 text-xs">
          <p className="mb-1 font-semibold">
            Готовность этапа:{" "}
            <span className={ready ? "text-green-700" : "text-amber-700"}>
              {ready ? "можно завершать" : "заполнено не всё"}
            </span>
          </p>
          <ul className="space-y-0.5 text-muted-foreground">
            <li>
              Краткое описание — {savedBrief ? "сохранено" : "не заполнено"}
            </li>
            <li>
              Первичные задачи — {savedTasks ? "сохранены" : "не заполнены"}
            </li>
          </ul>
          {dirty && (
            <p className="mt-1 text-amber-700">
              Есть несохранённые правки — сервер их пока не видит.
            </p>
          )}
        </div>

        {/* «Документы к подготовке» — блок эталона (таблица Документ /
            Ответственный / Срок). Перечня документов и их сроков модель не
            хранит вовсе: у мероприятия есть описание, задачи и расчёт, но
            списка бумаг с ответственными нет. Пустая таблица с тремя
            колонками выглядела бы поломкой, поэтому блок несёт причину и
            отправляет туда, где документы действительно лежат. */}
        <div className="rounded-lg border border-dashed p-3.5">
          <p className="text-sm font-semibold">Документы к подготовке</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Перечня документов с ответственными и сроками система не ведёт —
            ни в мероприятии, ни в справочниках. Нормативные документы, по
            которым готовят ОМ, лежат в разделе{" "}
            <Link
              href="/security-ops/laws"
              className="font-semibold text-primary-ink"
            >
              «Законы об ОМ»
            </Link>
            , а расчёт сил появляется на следующем этапе.
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          Что дальше: после завершения бюллетеня открывается рекогносцировка —
          осмотр объекта и расчёт постов старшим наряда.
        </p>

        <FieldErrors errors={fieldErrors} />
        <StageError error={update.error} />
        <StageError error={complete.error} />
        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={!dirty || update.isPending}
            onClick={() => {
              setFieldErrors(null);
              update.mutate({ briefDescription, initialTasks });
            }}
          >
            {update.isPending ? "Сохранение…" : "Сохранить бюллетень"}
          </Button>
          <Button
            type="button"
            disabled={complete.isPending || dirty}
            title={dirty ? "Сначала сохраните изменения." : undefined}
            onClick={() => complete.mutate({})}
          >
            {complete.isPending
              ? "Завершение…"
              : "Завершить этап → Рекогносцировка"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * «Сведения об ОМ» — паспортная шапка мероприятия из прототипа. Read-only:
 * ни одно поле блока бюллетень не правит.
 *
 * Все значения читаются из самого мероприятия; исключение — адрес: он живёт
 * в карточке объекта реестра, и запрос за ним уходит только с правом
 * `object.view` (иначе реестр объектов отвечает 403). Без права строка
 * называет причину, а не пустоту — иначе «адрес не заполнен» и «адрес не
 * показан» выглядели бы одинаково.
 *
 * Факты прототипа «охраняемые лица / старший ГВО / численность» с 21.08.2026
 * ЖИВЫЕ: они выводятся из сводки ГВО (база из бюллетеня + патч ручных правок
 * с бэка) — тем же слиянием, которым живёт реестр ГВО. Своего хранилища у
 * мероприятия по-прежнему нет, и это правильно: две записи об одних лицах
 * разошлись бы при первой правке. Пока сводка не заполнена, значения честно
 * говорят «уточняется», а ссылка ведёт туда, где их заполняют.
 */
function EventFacts({ event }: { event: SecurityEvent }) {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const objectId = event.objectId;
  const canViewObject = hasPermission("object.view") && objectId !== null;
  const objectQuery = useSecurityObject(canViewObject ? objectId : "");
  // Сводка ГВО: та же сборка, что у реестра ГВО (база из бюллетеня + патч).
  // Страница уже за гейтом event.view — отдельного права у сводки нет.
  const patchesQuery = useGvoPatches();
  const summary = mergeGvoSummary(
    deriveGvoSummary(event),
    patchesByCode(patchesQuery.data)[event.code]
  );
  const personsLabel =
    summary.persons.length === 0
      ? UNSPECIFIED
      : summary.persons.map((person) => person.name).join(", ");
  const staff = gvoStaffCount(summary);

  // Незагруженные права — это ЕЩЁ НЕ отказ: `hasPermission` до ответа
  // /my-permissions отвечает false, и без этой ветки блок успевал обвинить
  // администратора в отсутствии права на первом кадре.
  const address =
    objectId === null
      ? "мероприятие не привязано к объекту реестра"
      : permissionsLoading || objectQuery.isLoading
        ? "загрузка карточки объекта…"
        : !canViewObject
          ? "нужно право «Объекты: просмотр»"
          : objectQuery.isError || objectQuery.data === undefined
            ? "карточка объекта недоступна"
            : objectQuery.data.address.trim() === ""
              ? "в карточке объекта не указан"
              : objectQuery.data.address;

  return (
    <section className="rounded-md border bg-muted/30 p-3">
      <h3 className="mb-2 text-sm font-semibold">Сведения об ОМ</h3>
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Номер ОМ" value={event.code} />
        <Fact label="Наименование ОМ" value={event.title} />
        {/* Тип, локация, время и старший вводятся в окне создания. У ОМ,
            заведённых до 23.08.2026, полей не было вовсе — «не указан»
            здесь честнее подставленного «Внутреннее». */}
        <Fact
          label="Тип мероприятия"
          value={
            event.kind === null
              ? "не указан"
              : SECURITY_EVENT_KIND_LABEL[event.kind]
          }
        />
        <Fact label="Объект проведения" value={objectLabel(event)} />
        <Fact label="Место / адрес" value={address} />
        <Fact
          label="Локация"
          value={event.location.trim() === "" ? "не указана" : event.location}
        />
        <Fact label="Дата начала" value={dayLabel(event.businessDate)} />
        <Fact
          label="Время начала"
          value={event.eventTime === null ? "не указано" : event.eventTime}
        />
        <Fact
          label="Дата окончания"
          value={
            event.businessDateEnd === null
              ? "не указана"
              : dayLabel(event.businessDateEnd)
          }
        />
        <Fact label="Продолжительность" value={durationLabel(event)} />
        <Fact
          label="Ответственный за ОМ"
          value={event.ownerName.trim() === "" ? "не назначен" : event.ownerName}
        />
        <Fact
          // Подпись зависит от типа: у визита иностранного лица старший
          // другой, и называть его «старшим наряда» было бы неправдой.
          label={event.kind === "FOREIGN" ? "Старший ГВО" : "Старший наряда"}
          value={event.chiefName.trim() === "" ? "не назначен" : event.chiefName}
        />
        <Fact label="Текущий статус" value={STAGE_LABEL[event.stage]} />
        <Fact label="Охраняемые лица" value={personsLabel} />
        <Fact
          label="Количество охраняемых лиц"
          value={summary.persons.length === 0 ? UNSPECIFIED : String(summary.persons.length)}
        />
        {/* Именно ГРУППЫ: `gvoSenior` ищет старшего среди состава ГВО в
            сводке. Старший мероприятия из бюллетеня стоит выше и это другой
            человек — одинаковая подпись у двух фактов путала бы. */}
        <Fact label="Старший группы ГВО" value={gvoSenior(summary)} />
        <Fact
          label="Численность ГВО"
          value={staff === 0 ? UNSPECIFIED : String(staff)}
        />
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        Охраняемые лица, старший ГВО и численность выводятся из{" "}
        <Link
          href={`/security-ops/gvo/${event.id}`}
          className="font-semibold text-primary-ink"
        >
          сводки ГВО
        </Link>
        {" "}— заполняются там же.
      </p>
    </section>
  );
}

/** «25.08.2026, вторник». Не ISO-дата показывается как пришла — придумывать
 * за сервер формат хуже, чем показать сырое значение. */
function dayLabel(isoDate: string): string {
  const day = ruDate(isoDate);
  if (day === null) return isoDate;
  const weekday = ruWeekdayName(isoDate);
  return weekday === null ? day : `${day}, ${weekday}`;
}

/** Продолжительность выводится из пары дат, а не хранится: третье поле рядом
 * с двумя датами разошлось бы с ними на первой же правке. */
function durationLabel(event: SecurityEvent): string {
  if (event.businessDateEnd === null) {
    return "не рассчитывается: окончание не указано";
  }
  const days = daySpanInclusive(event.businessDate, event.businessDateEnd);
  return days === null
    ? "не рассчитывается: окончание раньше начала"
    : ruDaysLabel(days);
}
