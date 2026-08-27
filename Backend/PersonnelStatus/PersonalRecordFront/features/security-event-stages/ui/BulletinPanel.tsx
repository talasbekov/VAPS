"use client";

// Бюллетень мероприятия — блок НАД этапами, а не первый этап цепочки
// (решение заказчика 24.08.2026, Plane «Реестр ОМ-4»). Раньше «Сведения об
// ОМ» и текст бюллетеня жили внутри первого шага и исчезали с экрана, как
// только бюллетень завершали: на рекогносцировке и дальше человек не видел ни
// типа мероприятия, ни периода, ни старшего.
//
// Панель сворачиваемая: пока ОМ на стадии «Бюллетень», её заполняют — она
// раскрыта; дальше это справка о мероприятии — свёрнута, чтобы не отжимать
// активный этап вниз.
//
// Правка полей возможна на ЛЮБОЙ стадии, кроме закрытой: PATCH бюллетеня
// сервер принимает всегда, а с 25.08.2026 ОМ с объектом заводится сразу на
// рекогносцировке (Plane «Реестр ОМ-5») — привязка правки к стадии
// «Бюллетень» означала бы, что описание и задачи такому ОМ уже НИКОГДА не
// вписать. У закрытого ОМ панель — справка: закрытое дело не правят.
//
// СОЗНАТЕЛЬНО не перенесено из прототипа:
// * «Редактировать ОМ» — правки названия, даты и объекта бэк не принимает:
//   PATCH этапа принимает только описание и задачи;
// * «Документы к подготовке» — в прототипе эта таблица набрана литералом
//   (две строки прямо в разметке). Модели документов с ответственными и
//   сроками нет ни у бэка, ни в контракте, и выдумывать её на экране нельзя.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateBulletin } from "@/hooks/use-security-event-stages";
import { useSecurityObject } from "@/hooks/use-security-objects";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  SECURITY_EVENT_KIND_LABEL,
  STAGE_LABEL,
} from "@/entities/security-event";
import { objectLabel } from "@/entities/security-event";
import type { SecurityEvent } from "@/entities/security-event";
import { daySpanInclusive, ruDate, ruDaysLabel, ruWeekdayName } from "@/lib/ru-date";
import { useGvoSummary } from "@/hooks/use-gvo-summaries";
import {
  UNSPECIFIED,
  gvoSenior,
  gvoStaffCount,
} from "@/entities/gvo-summary";
import { Fact } from "./Fact";
import { FieldErrors, StageError } from "./StageErrors";

export function BulletinPanel({
  event,
  onDirtyChange,
  gvoOpen,
  onToggleGvo,
}: {
  event: SecurityEvent;
  /** Несохранённый черновик виден СНАРУЖИ: кнопка «Открыть рекогносцировку»
   * живёт в области этапа, а завершённый бюллетень правку уже не примет —
   * без этого сигнала набранный текст молча пропадал бы вместе с формой. */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Состояние панели «Информация по ГВО» и её переключатель (Plane №193).
   * Заказчик: «Кнопка Информация по ГВО должна стоять на бюллетени визита
   * иностранного ОЛ, а не на первом этапе рекогносцировке». Кнопка стояла в
   * шапке карточки — над степпером, и читалась как принадлежащая ТЕКУЩЕМУ
   * этапу, каким бы он ни был.
   *
   * Состояние остаётся СНАРУЖИ, а не заводится здесь: сама панель ГВО
   * рисуется страницей отдельным блоком под бюллетенем, и второй хозяин у
   * одного «открыто/закрыто» означал бы рассинхрон при первой же правке.
   *
   * `onToggleGvo` не передан — кнопки нет вовсе: у внутреннего мероприятия
   * выездной охраны не бывает, и кнопка обещала бы пустоту.
   */
  gvoOpen?: boolean;
  onToggleGvo?: () => void;
}) {
  const editable = event.stage !== "CLOSED";
  // Рекогносцировка ещё не открыта — бюллетень сейчас ЗАПОЛНЯЮТ.
  const awaitingRecon = event.stage === "BULLETIN";
  const [briefDescription, setBriefDescription] = useState(event.briefDescription);
  const [initialTasks, setInitialTasks] = useState(event.initialTasks);
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );

  const update = useUpdateBulletin(event.id, {
    onFormError: (details) => setFieldErrors(details),
  });

  const dirty =
    briefDescription !== event.briefDescription ||
    initialTasks !== event.initialTasks;

  // Готовность считается по СОХРАНЁННОМУ бюллетеню, а не по полям формы:
  // сервер смотрит на своё состояние, и набранный, но не сохранённый текст
  // этап не откроет.
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const savedBrief = event.briefDescription.trim() !== "";
  const savedTasks = event.initialTasks.trim() !== "";
  const ready = savedBrief && savedTasks;

  // Раскрыта, пока бюллетень — предмет работы: до открытия рекогносцировки
  // его заполняют, и после неё тоже, если он пуст (ОМ с объектом стартует с
  // рекогносцировки, и свёрнутая панель спрятала бы ЕДИНСТВЕННОЕ место, где
  // описание и задачи вписывают). Заполненный бюллетень дальше по цепочке —
  // справка: он свёрнут, чтобы не отжимать активный этап вниз.
  const [open, setOpen] = useState(awaitingRecon || (!ready && editable));

  return (
    <Card className="mb-4" data-testid="bulletin-panel">
      <CardContent className="p-0">
        {/* Строка заголовка — flex-РЯД из двух самостоятельных кнопок:
            раскрыватель слева и «Информация по ГВО» справа. Ряд, а не кнопка
            с кнопкой внутри: вложенная кнопка недопустима в разметке, и
            попытка обойтись отрицательным отступом держалась бы на высоте
            строки — она меняется от первого же изменения подписи. */}
        <div className="flex items-center gap-2 pr-4">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="bulletin-panel-body"
            className="flex flex-1 items-center gap-2 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {open ? (
              <ChevronDown
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              <ChevronRight
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <span className="text-sm font-semibold">Бюллетень мероприятия</span>
            <span className="text-xs text-muted-foreground">
              {!editable
                ? "сведения об ОМ"
                : ready
                  ? "заполнен"
                  : "заполнен не полностью"}
            </span>
          </button>

          {/* Кнопка ГВО стоит НА БЮЛЛЕТЕНЕ (Plane №193). Заказчик: «Кнопка
              Информация по ГВО должна стоять на бюллетени визита иностранного
              ОЛ, а не на первом этапе рекогносцировке». Прежде она жила в
              шапке карточки — над степпером — и читалась как принадлежащая
              ТЕКУЩЕМУ этапу, каким бы он ни был.

              `onToggleGvo` не передан — кнопки нет вовсе: у внутреннего
              мероприятия выездной охраны не бывает, и кнопка обещала бы
              пустоту. */}
          {onToggleGvo !== undefined && (
            <Button
              type="button"
              variant={gvoOpen === true ? "default" : "outline"}
              size="sm"
              className="shrink-0"
              aria-expanded={gvoOpen === true}
              aria-controls="gvo-summary-panel"
              onClick={onToggleGvo}
            >
              {gvoOpen === true
                ? "Скрыть информацию по ГВО"
                : "Информация по ГВО"}
            </Button>
          )}
        </div>

        {/* Тело не снимается со страницы, а прячется: `aria-controls`
            обязан указывать на существующий узел именно в свёрнутом
            состоянии, а набранный черновик не должен умирать от того, что
            панель свернули. */}
        <div
          id="bulletin-panel-body"
          hidden={!open}
          className="space-y-4 px-4 pb-4"
        >
            <EventFacts event={event} />

            {editable ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="bulletin-brief">Краткое описание *</Label>
                  <Textarea
                    id="bulletin-brief"
                    value={briefDescription}
                    onChange={(e) => setBriefDescription(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bulletin-tasks">
                    Первичные задачи направлениям *
                  </Label>
                  <Textarea
                    id="bulletin-tasks"
                    value={initialTasks}
                    onChange={(e) => setInitialTasks(e.target.value)}
                  />
                </div>
                {/* Кнопка завершения живёт в области этапа и НЕ блокируется по
                    этим признакам: правило «описание и задачи заполнены»
                    держит сервер, и второй гард рядом маскировал бы его
                    отказ. Здесь только видимое состояние. */}
                <div className="rounded-md border px-3 py-2 text-xs">
                  {/* Строка готовности — про переход, поэтому она стоит
                      только там, где переход есть: на рекогносцировке и
                      дальше «можно открывать рекогносцировку» было бы
                      обещанием уже случившегося. */}
                  {awaitingRecon && (
                    <p className="mb-1 font-semibold">
                      Готовность бюллетеня:{" "}
                      <span className={ready ? "text-green-700" : "text-amber-700"}>
                        {ready
                          ? "можно открывать рекогносцировку"
                          : "заполнено не всё"}
                      </span>
                    </p>
                  )}
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
              </>
            ) : (
              /* Переносы строк сохраняются: задачи направлениям набирают
                 списком, и `Fact` со своим `dd.inline` склеивал бы их в одну
                 строку. */
              <dl className="space-y-2 text-xs">
                <div>
                  <dt className="font-semibold text-muted-foreground">
                    Краткое описание
                  </dt>
                  <dd className="whitespace-pre-line">
                    {savedBrief ? event.briefDescription : "не заполнено"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted-foreground">
                    Первичные задачи направлениям
                  </dt>
                  <dd className="whitespace-pre-line">
                    {savedTasks ? event.initialTasks : "не заполнены"}
                  </dd>
                </div>
              </dl>
            )}

            {/* «Документы к подготовке» — блок эталона (таблица Документ /
                Ответственный / Срок). Перечня документов и их сроков модель
                не хранит вовсе: у мероприятия есть описание, задачи и расчёт,
                но списка бумаг с ответственными нет. Пустая таблица с тремя
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
                , а расчёт сил появляется на этапах ниже.
              </p>
            </div>

            {editable && (
              <>
                <FieldErrors errors={fieldErrors} />
                <StageError error={update.error} />
                <div className="flex justify-end">
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
                </div>
              </>
            )}
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
  // Сводка ГВО приходит СОБРАННОЙ с сервера (Plane №166). Страница уже за
  // гейтом event.view — отдельного права у сводки нет.
  const summaryQuery = useGvoSummary(event.code);
  const summary = summaryQuery.data?.summary;
  // Три факта ниже читаются из сводки. Её отсутствие — НЕ «уточняется»:
  // «уточняется» значит «знаем, что нужно, и ещё не выяснили», а здесь мы не
  // знаем вовсе. Подставить сюда «уточняется» значило бы выдать отказ за
  // рабочее состояние бюллетеня.
  const gone = summaryQuery.isLoading ? "загрузка сводки…" : "сводка недоступна";
  const personsLabel =
    summary === undefined
      ? gone
      : summary.persons.length === 0
        ? UNSPECIFIED
        : summary.persons.map((person) => person.name).join(", ");
  const staff = summary === undefined ? null : gvoStaffCount(summary);

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
          value={
            summary === undefined
              ? gone
              : summary.persons.length === 0
                ? UNSPECIFIED
                : String(summary.persons.length)
          }
        />
        {/* Именно ГРУППЫ: `gvoSenior` ищет старшего среди состава ГВО в
            сводке. Старший мероприятия из бюллетеня стоит выше и это другой
            человек — одинаковая подпись у двух фактов путала бы. */}
        <Fact
          label="Старший группы ГВО"
          value={summary === undefined ? gone : gvoSenior(summary)}
        />
        <Fact
          label="Численность ГВО"
          value={staff === null ? gone : staff === 0 ? UNSPECIFIED : String(staff)}
        />
      </dl>
      {/* Модуля «Реестр ГВО» больше нет (Plane «Реестр ОМ-35.8»): сводка
          живёт панелью в ЭТОЙ же карточке, и ссылка ведёт в неё —
          `?gvo=1` раскрывает панель. Уводить на отдельный экран было бы
          обещанием страницы, которой не существует. */}
      <p className="mt-2 text-xs text-muted-foreground">
        Охраняемые лица, старший ГВО и численность выводятся из{" "}
        <Link
          href={`/security-ops/events/${event.id}?gvo=1`}
          className="font-semibold text-primary-ink"
        >
          сводки ГВО
        </Link>
        {/* Адрес кнопки в подписи ОБЯЗАН совпадать с местом, где она стоит:
            с №193 она в заголовке этой самой панели, а не в шапке карточки.
            Подпись, отсылающая не туда, хуже отсутствия подписи — человек
            ищет кнопку там, где её нет. */}
        {" "}— кнопка «Информация по ГВО» в заголовке этой панели.
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
