// Домен «Охранное мероприятие» (ОМ). Полный жизненный цикл:
// bulletin → recon → demand → forces → placement → approval →
// acknowledgement → conduct → closed.
import type { EventVehicle } from "@/entities/vehicle";
/**
 * Снимок привязки ОМ к опубликованной версии паспорта объекта. Именно снимок,
 * а не ссылка: публикация новой версии паспорта не переписывает согласованную
 * расстановку. objectName продублирован сознательно — переименование объекта
 * не должно задним числом менять заархивированные документы.
 */
export interface PassportBinding {
  objectId: string;
  objectName: string;
  versionId: string;
  versionNumber: number;
  /** Дата, с которой действует привязанная версия (YYYY-MM-DD). */
  effectiveFrom: string;
  boundAt: string;
}

export const SECURITY_EVENT_STAGES = [
  "BULLETIN",
  "RECON",
  "DEMAND",
  "FORCES",
  "PLACEMENT",
  "APPROVAL",
  "ACKNOWLEDGEMENT",
  "CONDUCT",
  "CLOSED",
] as const;

export type SecurityEventStage = (typeof SECURITY_EVENT_STAGES)[number];

/** Результат проверки пункта чек-листа/поста рекогносцировки. */
export type ReconCheckResult = "MATCHES" | "NEEDS_CHANGES" | null;

export interface ReconChecklistItem {
  id: string;
  label: string;
  done: boolean;
  result: ReconCheckResult;
  comment: string;
}

/**
 * Строка «Посты и секторы» рекогносцировки — event-specific расчёт на основе
 * паспорта; правка строки не редактирует паспорт. sourceSectorId/sourcePostId
 * заполнены при импорте из привязанной версии паспорта, null у ручных строк.
 */
export interface ReconSectorPost {
  id: string;
  sector: string;
  post: string;
  task: string;
  need: number;
  /**
   * Смена поста — свойство ПОСТА, как в эталоне («Сектор A · смена
   * 07:00–15:00»). До Plane №123 её вводили в строке потребности, и когда бокс
   * потребности сняли (№110), задавать смену стало негде вовсе.
   *
   * Необязательная: строки, заведённые до появления поля, её не несут, а
   * расстановка у таких мероприятий по-прежнему читает смену из строки
   * потребности — старый источник живёт, пока его кто-то читает.
   */
  shift?: string;
  requirements: string;
  result: ReconCheckResult;
  comment: string;
  sourceSectorId: string | null;
  sourcePostId: string | null;
  /** Требование поста к рейтингу; null — требования нет (не «ноль»). */
  minRating: number | null;
  /**
   * Колонки таблицы постов из прототипа. Хранятся в том же JSON-поле, что и
   * остальная строка расчёта, — миграции не требуют, сервер пропускает
   * незнакомые ключи как есть (update_recon разворачивает строку через **row).
   * Необязательные: строки, заведённые до появления колонок, их не несут.
   */
  postType?: string;
  weapon?: string;
  uniform?: string;
  /** Пост-родитель для подпоста; пусто — строка самостоятельная. */
  parentPostId?: string;
  /**
   * ЧЕЙ это пост — объект посещения, к которому он относится (Plane №408,
   * требование `[РЕК-05]`/`[РЕК-08]` спецификации). Из этой разметки сервер
   * считает «потребность» и «назначено» объекта в раскрытой строке реестра.
   *
   * `null` — не размечен: так выглядят строки, заведённые до №408 у ОМ с
   * НЕСКОЛЬКИМИ объектами. Разметить их задним числом нельзя (в строке объект
   * не записан), и экран у таких объектов честно отвечает «неизвестно», а не
   * делит общий расчёт поровну. У ОМ с единственным объектом разметку
   * проставила миграция.
   */
  visitObjectId?: string | null;
}

/** Строка потребности в силах. */
export interface StaffingDemandRow {
  id: string;
  sector: string;
  task: string;
  shift: string;
  need: number;
  group: string;
  requirements: string;
  comment: string;
}

export type ForceRequestStatus =
  | "NOT_SENT"
  | "SENT"
  | "PARTIALLY_ALLOCATED"
  | "ALLOCATED";

/** Запрос группе — агрегат, автосформированный при утверждении потребности. */
export interface ForceRequest {
  id: string;
  group: string;
  requestedCount: number;
  allocatedCount: number;
  status: ForceRequestStatus;
  comment: string;
}

/** Состояние заявки департаменту в цепочке «Сбор сил на ОМ» (Plane №73).
 *
 * `DRAFT` — штаб разложил, но департаменту ещё не сказали; дальше по цепочке
 * идут оповещение управлений, отправка списка и решение штаба (шаги СС-2…СС-5).
 */
export type ForceAllocationStatus =
  | "DRAFT"
  | "NOTIFIED"
  | "SUBMITTED"
  | "ACCEPTED"
  | "RETURNED"
  /** Департамент ответил «Выделяем: 0» (Plane №391, `[СБС-21]`). Отдельно от
   *  `SUBMITTED` с пустым списком: штаб отличает «нам отказали» от «прислали
   *  пусто» — второе сервер и не принимает. */
  | "DECLINED";

/** Управление внутри департамента, которому ушла заявка (заполняется СС-2). */
export interface ForceAllocationDirectorate {
  id: string;
  divisionId: string;
  name: string;
  /** Квота управления — сколько человек с него просит департамент
   * (Plane №272, Ш-1). Третий уровень раскладки: штаб делит потребность
   * между департаментами, департамент — между своими управлениями. У строк,
   * заведённых до Ш-1, стоит 0 — департамент их ещё не раскладывал. */
  need: number;
  /** Сколько человек управление УЖЕ выделило (Plane №272, Ш-2).
   *
   * Считается сервером НА ЧТЕНИИ и не хранится: человек переводится между
   * управлениями мимо мероприятия, и записанная копия описывала бы вчерашнюю
   * структуру. Клиент своего счёта не заводит — второй ответ на тот же вопрос
   * разошёлся бы с сервером при первом же переводе. */
  assigned: number;
  notifiedAt: string | null;
}

/** Выделенный управлением сотрудник (заполняется СС-3). */
export interface ForceAllocationMember {
  employeeId: string;
  name: string;
  /** Откуда строка взялась (Plane №274, Ш-5): `"STATUS"` — человек попал в
   * список через статус участия, записи штаба у него нет, и снять его как
   * выделенного нельзя. Отсутствие поля означает запись штаба. */
  source?: "STATUS";
  /** Вид и роль участия — только у строк из статуса. */
  kindCode?: string;
  roleCode?: string;
  divisionId: string;
  divisionName: string;
  addedAt: string;
}

/** Заявка ДЕПАРТАМЕНТУ: сколько людей он должен выделить на мероприятие.
 *
 * Не путать с `ForceRequest`: там числа по свободным «группам» утверждённой
 * потребности, адресата у них нет вовсе.
 */
export interface ForceAllocationRow {
  id: string;
  departmentId: string;
  departmentName: string;
  need: number;
  status: ForceAllocationStatus;
  /** Комментарий ШТАБА к строке раскладки (с `forces/allocation/`). Ответ
   *  департамента живёт в `answerComment`, причина возврата штабом — в
   *  `decisionComment`: три разных автора, три разных ключа. */
  comment: string;
  /** «Выделяем: X» — ответ департамента на запрос `need` (Plane №391,
   *  `[СБС-21]`). `null`/нет поля — департамент ещё не отвечал. Цифру ставит
   *  ответственный, штаб читает; ограничений нет — меньше, больше, 0. */
  allocating?: number | null;
  /** Комментарий департамента к цифре «Выделяем» (Plane №391). */
  answerComment?: string;
  /** Момент отказа (`allocating === 0`); `null` — отказа нет или снят. */
  declinedAt?: string | null;
  /** Срок сдачи списка (Plane №287). По умолчанию — за сутки до начала ОМ,
   *  штаб может назначить свой. `null`/отсутствует — срока нет. */
  dueAt?: string | null;
  /** Срок вышел, а список не отправлен. Считает СЕРВЕР — «опоздал» не должно
   *  зависеть от часов браузера. */
  overdue?: boolean;
  /** Список отправлен после срока: опоздание отправку не запрещает, но
   *  записывается. */
  submittedLate?: boolean;
  notifiedAt: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionComment: string;
  directorates: ForceAllocationDirectorate[];
  members: ForceAllocationMember[];
}

/** Человек в СОСТАВЕ мероприятия: штаб принял его и отдал ОМ (шаг СС-5).
 *
 * Не то же, что назначение на пост: в состав человек приходит до расстановки и
 * остаётся в нём, когда его с поста снимают.
 */
export interface ForceRosterMember {
  employeeId: string;
  name: string;
  divisionId: string | null;
  divisionName: string;
  departmentId: string | null;
  departmentName: string;
  /** null — состав выведен из расстановки миграцией, решения штаба не было. */
  acceptedAt: string | null;
  /** Статус на деловую дату ОМ; null — статуса нет, что и есть «в строю». */
  statusCode: string | null;
  statusLabel: string | null;
}

/** Назначение сотрудника на пост. Двойное назначение внутри одного ОМ запрещено. */
/** Лицо бюллетеня с атрибутами визита (Plane №418, `[МД-03]`). Атрибуты
 * необязательны: бюллетень заводят до того, как известен борт. */
export interface EventProtectedPerson {
  id: string;
  /** Код `OL-N` (Plane №417). */
  code: string;
  name: string;
  /** ISO «ГГГГ-ММ-ДДTЧЧ:ММ»; null — не указано. */
  arrivalAt: string | null;
  departureAt: string | null;
  flightArrival: string;
  flightDeparture: string;
  /** Старший делегации; главное лицо бланка — отдельное поле. */
  isSenior: boolean;
  note: string;
}

/** Строка `protectedPersonDetails` запроса: ключи, которых нет, не трогаются. */
export interface EventProtectedPersonDetails {
  id: string;
  arrivalAt?: string;
  departureAt?: string;
  flightArrival?: string;
  flightDeparture?: string;
  isSenior?: boolean;
  note?: string;
}

export interface PlacementAssignment {
  id: string;
  postId: string;
  employeeId: string;
  employeeName: string;
  /** Ознакомление: null до подтверждения. */
  acknowledgedAt: string | null;
  /** «Не могу заступить» (Plane №405): отказ и подтверждение снимают друг
   * друга. Строки, заведённые до №405, ключей не несут — читать как null. */
  declinedAt?: string | null;
  declineReason?: string | null;
  /** Последнее напоминание (Plane №432); нет ключа — не напоминали. */
  remindedAt?: string | null;
  /** Обоснование обхода предупреждения по рейтингу; заполнено только если предупреждение было. */
  ratingOverrideReason: string | null;
  /** Роль наряда из справочника `PLACEMENT_ROLES` (Plane №238). `null` —
   * роль не назначена: место в бланке «Общая расстановка» останется пустым,
   * и это честнее, чем поставить туда человека наугад. */
  roleCode: string | null;
  /** Секция бланка из справочника `PLACEMENT_SECTIONS` (Plane №242) — ВТОРАЯ
   * координата места: роль отвечает «кем человек идёт», секция «где».
   * «Көшпелі күзетінің жауаптысы» есть у восьми выездных охран подряд, и по
   * одной роли документ ставил первого назначенного в первую охрану наугад.
   * `null` — секция не назначена либо строка заведена до №242. */
  sectionCode: string | null;
  /** Подразделение сотрудника; пусто — штатной единицы у него нет. */
  divisionName: string;
  /** Статус на ДЕЛОВУЮ дату мероприятия. null — действующего статуса нет,
   * что и есть «в строю»: строки «в строю» в справочнике не существует, и
   * подписывает её клиент. Оба поля считаются сервером на чтении — копия,
   * записанная в момент назначения, соврала бы к утру. */
  statusCode: string | null;
  statusLabel: string | null;
  /** Старший СЕКТОРА (сектор берётся у поста): один на сектор. */
  isSectorSenior: boolean;
}

export type ApprovalStatus = "PENDING" | "APPROVED" | "RETURNED";

/**
 * Строка маршрута согласования из прототипа: кто согласует, в каком порядке и
 * с каким решением. Порядок — позиция в списке; отдельного поля под номер нет,
 * иначе появились бы два источника правды.
 */
/**
 * Состояние согласующего в маршруте. `NOT_SENT` — начальное: человека внесли
 * в маршрут, но расстановку ему ещё не ОТПРАВЛЯЛИ, и решать ему нечего.
 * `PENDING` значит «на согласовании» — отправлено, решения нет.
 */
export type ApproverStatus = "NOT_SENT" | "PENDING" | "APPROVED" | "RETURNED";

export interface Approver {
  id: string;
  name: string;
  unit: string;
  position: string;
  status: ApproverStatus;
  /** null — решение ещё не принято. */
  decidedAt: string | null;
  comment: string;
}

/**
 * Статус замечания (`[МД-07]`, Plane №386): «Открыто → Устранено | Не
 * согласен». Тройной, а не булев: «не согласен, вот почему» — законный исход,
 * который бинарное «устранено/нет» выразить не могло.
 */
export type ApprovalRemarkStatus = "OPEN" | "RESOLVED" | "DISAGREED";

/**
 * Замечание, порождённое ВОЗВРАТОМ согласующего. Отдельный список, а не поле
 * у согласующего: один человек возвращает дважды по разным поводам, и вторая
 * причина затёрла бы первую, хотя закрывают их по одной.
 *
 * Форма — `[МД-07]` (Plane №386): привязка, срочность, статус, ответ, версия.
 */
export interface ApprovalRemark {
  id: string;
  /** Согласующий маршрута, вернувший расстановку; `null` — общий возврат. */
  approverId: string | null;
  author: string;
  createdAt: string;
  text: string;
  /** Привязка к посту расчёта; `null` — замечание общее по объекту. Сектора
   * как отдельной привязки нет: у него нет своего идентификатора. */
  postId: string | null;
  /** Срочно — поставлено согласующим ИЛИ автоматически, если до даты ОМ
   * осталось не более суток (`[ВОЗ-02]`). */
  urgent: boolean;
  status: ApprovalRemarkStatus;
  /** Ответ старшего объекта. Обязателен при «Не согласен», иначе пусто. */
  response: string;
  /** Когда ответили; `null` — замечание ещё открыто. */
  respondedAt: string | null;
  /** Версия документа «Расстановка сил», в которой замечание ПОСТАВЛЕНО. */
  documentVersion: number;
  /** Версия, в которой замечание ЗАКРЫТО решением; `null` — ещё открыто. */
  resolvedInDocumentVersion: number | null;
}

/**
 * Статус версии документа «Расстановка сил» (`[СОГ-01]`, Plane №398):
 * Черновик → На согласовании → Согласовано | Возвращено. Одна версия проходит
 * эти состояния; новый номер появляется только повторной отправкой после
 * возврата (`[ВОЗ-06]`).
 */
export type DocumentVersionStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "RETURNED";

/**
 * Версия документа «Расстановка сил» объекта (`[СОГ-04]`). Все версии
 * хранятся; отменённая помечена `supersededAt`, статус её не стирается —
 * согласованная и позже заменённая версия остаётся согласованной в истории.
 */
export interface DocumentVersion {
  number: number;
  status: DocumentVersionStatus;
  /** Подпись состава — та же строка, по которой сервер считает «расстановка
   * изменилась после отправки». */
  signature: string;
  createdAt: string;
  createdBy: string;
  sentAt: string | null;
  decidedAt: string | null;
  supersededAt: string | null;
}

/** Внешний кадровый read-only снимок — только для подбора кандидатов. */
export interface PersonnelSummarySnapshot {
  id: string;
  name: string;
  rankLabel: string;
  unit: string;
  /** Статус на дату, СПРОШЕННУЮ клиентом (`business_date`). null — либо даты
   * не спрашивали, либо статуса на неё нет: форма ответа одна на оба случая,
   * две заставили бы читателя гадать, что ему пришло. */
  statusCode: string | null;
  statusLabel: string | null;
  /** Агрегат оперативного рейтинга (Plane №67, шаг РЙ-4).
   *
   * Поля НЕТ ВОВСЕ, когда у спросившего нет права `rating.view_aggregate` —
   * это НЕ то же самое, что `null`. `null` значит «судить не по чему»:
   * человек не связан с рейтингом, оценок меньше порога методики либо
   * функция выключена. Отсутствие поля значит «вам не показывают», и
   * рисовать по нему «нет данных» нельзя — это соврало бы о сотруднике. */
  aggregateRating?: number | null;
}

export type JournalEntryType = "INSTRUCTION" | "ORDER" | "INCIDENT" | "REPLACEMENT";

export interface JournalEntry {
  id: string;
  type: JournalEntryType;
  title: string;
  description: string;
  createdAt: string;
}

/** Итог направления при закрытии (итоги всех направлений обязательны). */
export interface ClosureDirectionSummary {
  direction: string;
  summary: string;
}

/**
 * Тип мероприятия. От него зависят маршрут согласования и старший:
 * FOREIGN уводит запись в реестр ГВО и назначает старшего ГВО.
 */
export type SecurityEventKind = "INTERNAL" | "FOREIGN";

export const SECURITY_EVENT_KIND_LABEL: Record<SecurityEventKind, string> = {
  INTERNAL: "Внутреннее",
  FOREIGN: "С участием иностранцев",
};

/**
 * Объект посещения в рамках ОМ. Мероприятие — это бюллетень, у которого может
 * быть несколько объектов: реестр раскрывает строку мероприятия именно этим
 * списком. У объекта СВОЁ охраняемое лицо и своя привязка паспорта.
 */
export interface VisitObject {
  id: string;
  /** Объект реестра; null — объект удалён, снимок имени остался. */
  objectId: string | null;
  objectName: string;
  passportBinding: PassportBinding | null;
  /** Охраняемое лицо этого объекта; null — не названо. */
  protectedPersonId: string | null;
  protectedPersonName: string;
  position: number;
  /**
   * День посещения в формате ISO; `null` — посещение идёт в дату мероприятия.
   * Это ОТВЕТ, а не пробел: у однодневного ОМ дата названа в бюллетене, и
   * дублировать её в каждой строке значило бы завести второй ответ.
   */
  visitDay: string | null;
  /** Примечание к посещению («основной объект», время) — свободный текст. */
  note: string;
  /**
   * Старший ЭТОГО объекта посещения — не старший мероприятия: у визита
   * иностранного ОЛ объектов несколько, ответственный у каждого свой.
   * `null` — не назначен, и это ответ: объект может стоять в маршруте
   * раньше, чем под него нашли человека.
   */
  chiefEmployeeId: string | null;
  /** Снимок подписи старшего: увольнение не превращает строку в номер. */
  chiefName: string;
  /**
   * Готовность расстановки: сколько людей нужно постам объекта и сколько
   * назначено. `null` — НЕИЗВЕСТНО (расчёт постов не размечен по объектам),
   * `0` — посты не рассчитаны. Это разные ответы, и экран их различает.
   */
  placementNeed: number | null;
  placementAssigned: number | null;
  /** Замещающие старшего на этом объекте: кто может править его расстановку,
   * не имея общего права вести мероприятие. Приходят вместе со строкой
   * объекта — раскрытие реестра иначе стучалось бы за списком на каждую. */
  deputies: VisitObjectDeputy[];
  /**
   * Этап ОБЪЕКТА (Plane №412, Ш-6 плана №385). Требование `[МД-04]`: «у
   * объекта свои этапы 1–5». Этап МЕРОПРИЯТИЯ — наименьший среди объектов,
   * то есть вывод из этого поля, а не второй ответ рядом с ним: мероприятие
   * прошло этап тогда, когда его прошёл последний объект.
   */
  stage: SecurityEventStage;
  /** Момент закрытия объекта; `null` — объект не закрыт. */
  closedAt: string | null;
  /** Итоговый комментарий по объекту при закрытии (`[ЗАК-04]`, Plane №404). */
  closingComment: string;
  /** Статус объекта словами (`[РЕЕ-08]`/`[РЕК-08]`, Plane №423) — считает сервер. */
  statusLabel: string;
  /**
   * ── Согласование ОБЪЕКТА (Plane №411, Ш-5 плана №385) ──────────────────
   *
   * Требование `[МД-04]`: «У объекта свои этапы 1–5 и свой документ
   * „Расстановка сил“ с версиями». Согласуют ОБЪЕКТ: у каждого свой маршрут,
   * свои замечания и свой снимок состава. Одноимённые поля мероприятия
   * остаются и до Ш-7 (№413) показывают состояние ПЕРВОГО объекта — старый
   * читатель ничего не теряет.
   */
  approvalStatus: ApprovalStatus;
  /** Причина последнего возврата ЭТОГО объекта; пусто — возвратов не было. */
  approvalComment: string;
  approvalRoute: Approver[];
  approvalRemarks: ApprovalRemark[];
  /** Расстановка ОБЪЕКТА изменилась после отправки. Считает сервер — по
   * этому же признаку он отбивает завершение этапа. */
  approvalStale: boolean;
  /**
   * Номер версии документа «Расстановка сил» объекта. `0` — документ ещё не
   * уходил согласующим, и это ОТВЕТ, а не «первая версия»; растёт при каждой
   * отправке на согласование. Историю версий ведёт отдельная карточка
   * (№398) — здесь только номер текущей.
   */
  documentVersion: number;
  /** Статус ТЕКУЩЕЙ версии документа; `null` — версий ещё нет (расстановка не
   * завершалась). */
  documentStatus: DocumentVersionStatus | null;
  /** История версий документа — вся, включая отменённые (`[СОГ-04]`). */
  documentVersions: DocumentVersion[];
}

/** Замещающий на объекте посещения (Plane «Реестр ОМ-24»). */
export interface VisitObjectDeputy {
  id: string;
  employeeId: string;
  /** Снимок подписи: увольнение не превращает журнал в набор номеров. */
  employeeName: string;
  /** Право править расстановку СВОЕГО объекта. `false` — назначенный
   * наблюдатель: он в списке, но расстановку не трогает. */
  canEditPlacement: boolean;
  /** Кто выдал право — подпись человека, а не id учётки. */
  assignedBy: string;
  assignedAt: string;
}

export interface SecurityEvent {
  id: string;
  code: string;
  title: string;
  /** Объект реестра; null — ОМ заведено до появления привязки. */
  objectId: string | null;
  /** Снимок имени объекта: показывается и там, где objectId — null. */
  objectName: string;
  /** Версия паспорта на дату ОМ; null обрабатывается явно. */
  passportBinding: PassportBinding | null;
  businessDate: string;
  /** Дата окончания; null — однодневное ОМ либо заведённое до появления поля. */
  businessDateEnd: string | null;
  /** Тип мероприятия; null — ОМ заведено до появления поля. */
  kind: SecurityEventKind | null;
  /** Время начала «ЧЧ:ММ»; null — час не назван (необязательная деталь). */
  eventTime: string | null;
  /** Охраняемое лицо из справочника; null — не выбрано. */
  protectedPersonId: string | null;
  /** Снимок имени лица: показывается и там, где лицо скрыто из справочника. */
  protectedPersonName: string;
  /**
   * ВЕСЬ список лиц бюллетеня (Plane №188). Поля выше остаются и означают
   * ГЛАВНОЕ лицо — колонка «ОЛ» бланка одна, и кто-то обязан в неё попасть.
   *
   * Список отсортирован сервером ПО ИМЕНИ: у связи своего порядка нет, и
   * «как легло» менялось бы от каждой перезаписи, читаясь при этом как
   * значимое. Главное лицо названо отдельным полем, поэтому старшинство
   * списку не нужно.
   */
  protectedPersons: EventProtectedPerson[];
  /** Локация строкой; пусто — не указана. С Plane №418 собирается сервером
   * из структуры ниже («Страна, Город, адрес») и остаётся у всех, кто читал
   * её раньше. */
  location: string;
  /** Локация структурой (Plane №418, `[МД-02]`): страна → город → адрес. */
  countryId: string | null;
  countryName: string;
  cityId: string | null;
  cityName: string;
  address: string;
  /** Старший (наряда или ГВО — по типу мероприятия); null — не назначен. */
  chiefEmployeeId: string | null;
  /** Снимок подписи старшего — как ownerName. */
  chiefName: string;
  stage: SecurityEventStage;
  /** Готовность текущей стадии, 0–100 (демонстрационная метрика). */
  readinessPercent: number;
  forceNeed: number;
  conflictsCount: number;
  ownerName: string;
  /** Объекты посещения бюллетеня — минимум один (объект окна создания). */
  visitObjects: VisitObject[];
  /**
   * Машины реестра ГОН, ВЫДЕЛЕННЫЕ на мероприятие (Plane №215).
   *
   * Это не то же самое, что строки «Выделяемый транспорт» в сводке ГВО: те —
   * свободный текст, набранный человеком, и ни ГРНЗ, ни класса брони в них
   * нет. Оба источника живут рядом намеренно, пока у текста есть читатели.
   */
  vehicles: EventVehicle[];
  /** Бюллетень: краткое описание, обязательное поле этапа BULLETIN. */
  briefDescription: string;
  /** Бюллетень: первичные задачи направлениям. */
  initialTasks: string;
  reconChecklist: ReconChecklistItem[];
  reconSectorPosts: ReconSectorPost[];
  /** Запрос личного состава с рекогносцировки — ОЦЕНКА старшего наряда,
   * которую получает штаб 2-го департамента. Не путать с `forceNeed`: тот
   * считается системой из утверждённой потребности тремя шагами позже. */
  reconForceRequest: number;
  /** Момент отправки запроса штабу (проставляется завершением этапа), либо
   * `null` — запрос ещё черновик и штабу не виден. */
  reconForceRequestedAt: string | null;
  demandRows: StaffingDemandRow[];
  demandApproved: boolean;
  forceRequests: ForceRequest[];
  /** Раскладка потребности по департаментам — первое звено «Сбора сил». */
  forceAllocation: ForceAllocationRow[];
  /** Состав мероприятия — принятые штабом люди (шаг СС-5). */
  forceRoster: ForceRosterMember[];
  /** Сколько всего людей делит штаб. Считает СЕРВЕР: по этому же числу он
   * отбивает перебор, и второй счёт на клиенте разошёлся бы с ним молча. */
  forceDemandTotal: number;
  placementAssignments: PlacementAssignment[];
  approvalStatus: ApprovalStatus;
  approvalComment: string;
  approvalRoute: Approver[];
  /** Замечания от возвратов; закрываются по одному. */
  approvalRemarks: ApprovalRemark[];
  /** Расстановка изменилась ПОСЛЕ отправки на согласование. Считает сервер:
   * по этому же признаку он блокирует завершение этапа, и вторая реализация
   * правила на клиенте разошлась бы с ним молча. */
  approvalStale: boolean;
  journalEntries: JournalEntry[];
  closureDirectionSummaries: ClosureDirectionSummary[];
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Контракты API (реального бэка нет — pending, см. отчёт) ──────────────

export const SECURITY_EVENTS_PATH = "/api/ops/security-events/";

export function securityEventDetailPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/`;
}

/** Удаление мероприятия: своё право `event.delete`, ответ 204 без тела. */
export function securityEventDeletePath(id: string): string {
  return securityEventDetailPath(id);
}

export const BINDABLE_OBJECTS_PATH = `${SECURITY_EVENTS_PATH}bindable-objects/`;

/** Объекты посещения мероприятия: добавление и снятие. */
/** Выделение машины реестра на мероприятие и снятие её с него. */
export function eventVehiclesPath(eventId: string): string {
  return `${securityEventDetailPath(eventId)}vehicles/`;
}

export function eventVehicleDetailPath(
  eventId: string,
  allocationId: string
): string {
  return `${eventVehiclesPath(eventId)}${allocationId}/`;
}

export function visitObjectsPath(eventId: string): string {
  return `${securityEventDetailPath(eventId)}visit-objects/`;
}

export function visitObjectDetailPath(
  eventId: string,
  visitObjectId: string
): string {
  return `${visitObjectsPath(eventId)}${visitObjectId}/`;
}

/** Правка СВЕДЕНИЙ бюллетеня — название, период, время, ОЛ, локация
 * (Plane №192). Отдельный адрес, а не PATCH самого мероприятия: у ОМ есть
 * поля, которые правкой формы менять нельзя (стадия, состав, расстановка), и
 * ручка «что угодно из модели» однажды приняла бы и их. Тип мероприятия,
 * объекты и старший сюда НЕ входят — у каждого своя причина, см. сервер. */
export function eventDetailsPath(eventId: string): string {
  return `${securityEventDetailPath(eventId)}details/`;
}

/** Старший НАРЯДА мероприятия (Plane №190). ОДИН адрес на три действия:
 * назначение, замену и снятие — у мероприятия старший один, и «сначала
 * снимите» разбило бы обычную замену на две операции. Снятие — тот же POST
 * с пустым `employeeId`. Не путать с `visitObjectChiefPath`: старший наряда и
 * старший объекта — разные люди с разной ответственностью. */
export function eventChiefPath(eventId: string): string {
  return `${securityEventDetailPath(eventId)}chief/`;
}

/** Старший объекта посещения: POST назначает (и заменяет), DELETE снимает. */
export function visitObjectChiefPath(
  eventId: string,
  visitObjectId: string
): string {
  return `${visitObjectDetailPath(eventId, visitObjectId)}chief/`;
}

/** Замещающие на объекте посещения: назначение и отзыв права. */
export function visitObjectDeputiesPath(
  eventId: string,
  visitObjectId: string
): string {
  return `${visitObjectDetailPath(eventId, visitObjectId)}deputies/`;
}

export function visitObjectDeputyDetailPath(
  eventId: string,
  visitObjectId: string,
  deputyId: string
): string {
  return `${visitObjectDeputiesPath(eventId, visitObjectId)}${deputyId}/`;
}

/**
 * Подпись объекта мероприятия для экранов. Пустое имя — «объект не выбран»
 * (ОМ заводят до согласования маршрута), и это надо СКАЗАТЬ: пустое место в
 * строке «Объект: » читается как потерянное значение.
 */
export function objectLabel(event: {
  objectName: string;
}): string {
  return event.objectName === "" ? "не выбран" : event.objectName;
}

/** Строка реестра объектов для выбора: подпись и наличие паспорта. */
export interface BindableObject {
  id: string;
  name: string;
  code: string;
  publishedVersionCount: number;
}

export interface ListSecurityEventsParams {
  search: string;
  /** Одна стадия, `"ALL"` — без отбора, либо НЕСКОЛЬКО стадий через запятую:
   * ленты сбора сил спрашивают окно из трёх стадий одним запросом. */
  stage: SecurityEventStage | "ALL" | `${SecurityEventStage},${string}`;
  /** Границы периода по бизнес-дате (YYYY-MM-DD); пусто — без границы. */
  from: string;
  to: string;
  /** Точное имя ответственного; пусто — все. */
  owner: string;
  page: number;
  pageSize: number;
}

/** LimitOffset-подобный конверт — канон пагинируемых эндпоинтов. */
export interface ListSecurityEventsResponse {
  /** Значения фильтра «ответственный» — считает сервер по ВСЕМУ реестру. */
  owners: string[];
  count: number;
  next: string | null;
  previous: string | null;
  results: SecurityEvent[];
}

export interface CreateSecurityEventRequest extends Record<string, unknown> {
  title: string;
  /** Пусто — однодневное мероприятие. */
  businessDateEnd?: string;
  /** ОМ заводится НА ОБЪЕКТ реестра — иначе версию паспорта не к чему привязать. */
  objectId: string;
  businessDate: string;
  /** Обязателен: от типа зависят маршрут согласования и состав старших. */
  kind: SecurityEventKind;
  /** «ЧЧ:ММ»; пусто — час не назван. */
  eventTime?: string;
  /** Id из справочника «Охраняемые лица»; пусто — не выбрано.
   * Одиночное поле оставлено ради вызовов, написанных до №188; окно создания
   * шлёт `protectedPersonIds`. Прислали оба — список главнее. */
  protectedPersonId?: string;
  /** Список лиц бюллетеня (Plane №188); первое — главное. */
  protectedPersonIds?: string[];
  /** Атрибуты визита лиц из списка выше (Plane №418). */
  protectedPersonDetails?: EventProtectedPersonDetails[];
  /** Строка локации — вызовы до №418; при структуре ниже игнорируется. */
  location?: string;
  /** Локация структурой (Plane №418): страна → город → адрес. */
  countryId?: string;
  cityId?: string;
  address?: string;
  /** Id сотрудника — старшего наряда или ГВО; пусто — не назначен. */
  chiefEmployeeId?: string;
}

/** Строка выпадающего списка объектов в форме создания ОМ. */
export interface BindableObject {
  id: string;
  name: string;
  code: string;
  /** 0 — у объекта нет ни одной опубликованной версии паспорта. */
  publishedVersionCount: number;
}

export interface ListBindableObjectsResponse {
  results: BindableObject[];
}

// ── Контракты операций этапов карточки ОМ ────────────────────────────────

export interface UpdateBulletinRequest extends Record<string, unknown> {
  briefDescription: string;
  initialTasks: string;
}

export interface UpdateReconRequest extends Record<string, unknown> {
  checklist: ReconChecklistItem[];
  sectorPosts: ReconSectorPost[];
  /** Запрос личного состава. Необязателен: тело БЕЗ ключа оставляет
   * сохранённое число (сервер трактует «нет ключа» как «не трогать»), и
   * правка расчёта постов запрос штабу не стирает. */
  forceRequest?: number;
}

/** Секция потребности не даёт отдельного «сохранить черновик» — одна операция
 * сохраняет строки И утверждает потребность (без «сохранено, не утверждено»). */
export interface UpdateDemandRequest extends Record<string, unknown> {
  rows: StaffingDemandRow[];
}

export interface UpdateForceAllocationRequest extends Record<string, unknown> {
  allocatedCount: number;
  comment: string;
}

/** Выделение сотрудника управлением (Plane №73, СС-3). */
export interface AddAllocationMemberRequest extends Record<string, unknown> {
  employeeId: string;
}

/** Возврат списка департаменту: причина обязательна (Plane №73, СС-5). */
export interface ReturnAllocationRequest extends Record<string, unknown> {
  reason: string;
}

/** Раскладка потребности по департаментам: список целиком (Plane №73, СС-1). */
export interface SplitForceDemandRequest extends Record<string, unknown> {
  rows: {
    departmentId: string;
    need: number;
    comment?: string;
    /** Срок сдачи списка «ГГГГ-ММ-ДДTЧЧ:ММ» (Plane №287). Ключа НЕТ — сервер
     *  сохранит прежний срок либо поставит умолчание «за сутки до ОМ»;
     *  неразбираемое значение он отбивает 400, а не подменяет умолчанием. */
    dueAt?: string;
  }[];
}

export interface AssignPlacementRequest extends Record<string, unknown> {
  postId: string;
  employeeId: string;
  /** Роль наряда из справочника `PLACEMENT_ROLES` (Plane №239). Необязательна:
   * назначить человека на пост можно и без роли. */
  roleCode?: string;
  /** Секция бланка из справочника `PLACEMENT_SECTIONS` (Plane №242). Тоже
   * необязательна: расстановка без секции — «ещё не назначено», а не ошибка. */
  sectionCode?: string;
  /** Протокол обхода мягкого конфликта: оба поля добавляет confirmOverride
   * в корень тела — своего протокола у рейтинга нет намеренно. */
  override?: boolean;
  override_reason?: string;
}

/**
 * Завершение расстановки (`[РАС-06]`, Plane №396). Полная укомплектованность —
 * пустое тело; недобор — `override`/`override_reason` протоколом мягкого
 * конфликта (тем же, что у обхода предупреждения по рейтингу при назначении).
 */
export interface CompletePlacementRequest extends VisitObjectAddressed {
  override?: boolean;
  override_reason?: string;
}

export interface ReturnPlacementRequest extends VisitObjectAddressed {
  comment: string;
}

export interface AddJournalEntryRequest extends Record<string, unknown> {
  type: JournalEntryType;
  title: string;
  description: string;
}

export interface CloseSecurityEventRequest extends Record<string, unknown> {
  directionSummaries: ClosureDirectionSummary[];
}

/** Замена выбывшего: без авто-подбора кандидата — только ручной выбор,
 * атомарная замена одной мутацией (снять + назначить + запись в журнал). */
export interface ReplaceAssignmentRequest extends Record<string, unknown> {
  assignmentId: string;
  incomingEmployeeId: string;
  reasonCode: string;
}

export const OPS_PERSONNEL_PATH = "/api/ops/personnel/";

/**
 * Сотрудник, привязанный к учётной записи. Нужен «экрану сотрудника» на
 * ознакомлении: связать учётку с кадровой записью можно только через
 * Employee.user, а сопоставление по ФИО показало бы тёзке чужое назначение.
 * 404 EMPLOYEE_NOT_LINKED — привязки нет (сид её не заполняет).
 */
export const OPS_PERSONNEL_ME_PATH = "/api/ops/personnel/me/";

/**
 * Страница кадрового списка. ЕДИНСТВЕННЫЙ вид ответа ручки: безстраничная
 * ветка («весь снимок целиком») снята вместе с последним её читателем (Plane
 * №61) — два способа читать один список расходятся молча, а снимок на живой
 * кадровой базе это тысячи строк одним ответом.
 *
 * `next`/`previous` — НОМЕРА страниц (контракт раздела), `null` — края списка.
 */
export interface PersonnelPageResponse {
  results: PersonnelSummarySnapshot[];
  /** Сколько НАЙДЕНО всего — с учётом поиска, а не на странице. */
  count: number;
  next: string | null;
  previous: string | null;
}

/** Поиск идёт НА СЕРВЕР: фильтр по загруженной странице отвечал бы «такого
 * сотрудника нет», имея в виду «нет на этой странице». */
export function opsPersonnelPagePath(params: {
  search: string;
  page: number;
  pageSize: number;
  /** Подразделение-владелец: управление подбирает СВОИХ (Plane №73, СС-3).
   * Сервер отбирает по ПОДДЕРЕВУ — человек числится в отделе, а не в
   * управлении. */
  divisionId?: string;
  /** Деловая дата, НА КОТОРУЮ спрашивается статус (Plane №65, «Р-2»). Дату
   * даёт мероприятие: считать «сегодня» за клиента сервер не станет —
   * расстановка ведётся на будущий день. */
  businessDate?: string;
  /** Полоса рейтинга — КОД, а не подпись с экрана (Plane №67, шаг РЙ-4):
   * `9_10`, `8_9`, `7_8`, `below_7`, `no_data`. Отбор идёт НА СЕРВЕРЕ и до
   * постранички: пока он жил на клиенте, «нет кандидатов» означало «нет на
   * этой странице». Без права на агрегат сервер ОТБИВАЕТ отбор (403), а не
   * молчит: молча проигнорированный фильтр выглядел бы сработавшим. */
  ratingBand?: string;
  /** Порядок выдачи. `rating` — ранжирование по баллу ПО ВСЕЙ выборке
   * (решение заказчика 26.08.2026), а не в пределах страницы.
   *
   * Закрыто тем же правом `rating.view_aggregate`, что и само значение:
   * порядок САМ рассказывает балл — кто выше, тот сильнее. Без права сервер
   * отвечает 403.
   *
   * Безоценочные идут В КОНЕЦ: `null` значит «судить не по чему», а не ноль.
   * При равных баллах порядок задаёт фамилия — иначе страницы «плавали» бы
   * между запросами. */
  ordering?: "rating";
}): string {
  const query = new URLSearchParams({
    page: String(params.page),
    page_size: String(params.pageSize),
  });
  if (params.search.trim() !== "") query.set("search", params.search.trim());
  if ((params.divisionId ?? "").trim() !== "")
    query.set("division_id", (params.divisionId as string).trim());
  if ((params.businessDate ?? "").trim() !== "")
    query.set("business_date", (params.businessDate as string).trim());
  if ((params.ratingBand ?? "").trim() !== "")
    query.set("rating_band", (params.ratingBand as string).trim());
  if (params.ordering !== undefined) query.set("ordering", params.ordering);
  return `${OPS_PERSONNEL_PATH}?${query.toString()}`;
}

/** Старший сектора: назначить или снять (Plane №65, «Р-4»). */
export function securityEventPlacementSeniorPath(
  id: string,
  assignmentId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/${encodeURIComponent(assignmentId)}/senior/`;
}

export function securityEventBulletinPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/bulletin/`;
}
export function securityEventBulletinCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/bulletin/complete/`;
}
export function securityEventReconPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/recon/`;
}
export function securityEventReconImportPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/recon/import-from-passport/`;
}
export function securityEventReconCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/recon/complete/`;
}
// `securityEventDemandApprovePath` СНЯТ вместе с ручкой (Plane №149): стадию
// «Потребность» проходит сервер, формы у неё нет.
export function securityEventForceAllocationPath(
  id: string,
  requestId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/${requestId}/`;
}
/** Раскладка потребности по департаментам — список ЦЕЛИКОМ одним запросом:
 * «кому сколько» это одно решение штаба, и построчное сохранение позволяло бы
 * сумме уехать за потребность между двумя запросами. */
export function securityEventForcesSplitPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/`;
}
/** Заявки, адресованные департаментам актора (Plane №272, Ш-3).
 *
 * Своя ручка, а не фильтр по реестру ОМ: реестр отдаёт мероприятие целиком
 * (сведение людей и счёт по управлениям на каждое), и таблица из пяти
 * колонок платила бы за это на каждой строке. */
export function securityEventDepartmentRequestsPath(): string {
  return `${SECURITY_EVENTS_PATH}forces/requests/`;
}

/** Раскладка квоты департамента по управлениям (Plane №272, Ш-1). */
export function securityEventForcesDirectorateSplitPath(
  id: string,
  allocationId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/${encodeURIComponent(
    allocationId
  )}/split/`;
}

/** Строка заявки в разрезе департамента (Plane №272, Ш-3). */
export interface DepartmentRequestRow {
  eventId: string;
  code: string;
  title: string;
  businessDate: string;
  /** Время самого мероприятия — НЕ срок сдачи списка; срок едет отдельным
   * полем `dueAt` (Plane №287). */
  eventTime: string | null;
  location: string;
  stage: SecurityEventStage;
  allocationId: string;
  departmentId: string;
  departmentName: string;
  need: number;
  assigned: number;
  status: ForceAllocationStatus;
  /** Срок сдачи списка: момент, к которому департамент обязан отдать людей
   * (Plane №287). По умолчанию — за сутки до начала ОМ, штаб может назначить
   * свой. `null` — срока нет (строка старше правила и не попала в бэкфилл). */
  dueAt: string | null;
  /** Срок вышел, а список не отправлен. Считает СЕРВЕР по своим часам:
   * доверить это часам браузера значило бы, что «опоздал» зависит от того,
   * у кого какие часы. */
  overdue: boolean;
  /** Список отправлен ПОСЛЕ срока. Отправку опоздание не запрещает — оно её
   * помечает. */
  submittedLate: boolean;
}

/** Состояние сбора по МЕРОПРИЯТИЮ (Plane №271, Ш-1/Ш-3).
 *
 * Выводится сервером из строк раскладки, а не хранится: у мероприятия своего
 * поля «как идёт сбор» нет, и заводить его значило бы держать вторую правду
 * рядом с той, из которой она и так считается. */
export type ForceCollectionStatus = "NEW" | "NOTIFIED" | "IN_PROGRESS";

/** Строка списка сборов — вид ШТАБА (Plane №271, Ш-1). */
export interface ForceCollectionRow {
  eventId: string;
  code: string;
  title: string;
  businessDate: string;
  /** Время самого ОМ — не срок сбора. Срок живёт у КАЖДОЙ заявки отдельно
   *  (`dueAt`, Plane №287): общего срока у мероприятия нет, департаментам их
   *  назначает штаб по отдельности. */
  eventTime: string | null;
  location: string;
  stage: SecurityEventStage;
  need: number;
  allocated: number;
  gathered: number;
  departments: number;
  collectionStatus: ForceCollectionStatus;
  /** Сколько заявок этого сбора ПРОСРОЧЕНО (Plane №287). Штабу нужен ответ
   *  «есть ли отстающие», а не список сроков: сроки у заявок свои. */
  overdueCount?: number;
}

/** Сбор ЦЕЛИКОМ — карточка штаба (Plane №271, Ш-2). */
export interface ForceCollectionDetail {
  eventId: string;
  code: string;
  title: string;
  businessDate: string;
  eventTime: string | null;
  location: string;
  stage: SecurityEventStage;
  need: number;
  allocated: number;
  gathered: number;
  remaining: number;
  collectionStatus: ForceCollectionStatus;
  allocations: ForceAllocationRow[];
}

/** 🔴 `force-collection`, а не `forces/collection`: второй попадал бы в уже
 * заведённый `<id>/forces/<requestId>/` (только PATCH) и отвечал бы 405. */
export function securityEventForceCollectionPath(eventId: string): string {
  return `${SECURITY_EVENTS_PATH}${eventId}/force-collection/`;
}

export function securityEventForceCollectionsPath(): string {
  return `${SECURITY_EVENTS_PATH}forces/collections/`;
}

/** Заявка департаменту ЦЕЛИКОМ: мероприятие + строка раскладки (Ш-4). */
export interface DepartmentRequestDetail {
  eventId: string;
  code: string;
  title: string;
  businessDate: string;
  eventTime: string | null;
  location: string;
  stage: SecurityEventStage;
  allocation: ForceAllocationRow;
}

export function securityEventDepartmentRequestPath(allocationId: string): string {
  return `${SECURITY_EVENTS_PATH}forces/requests/${encodeURIComponent(
    allocationId
  )}/`;
}

/** Ответ департамента «Выделяем: X · Комментарий» (Plane №391, `[СБС-21]`). */
export function securityEventForcesRespondPath(id: string, allocationId: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/${encodeURIComponent(
    allocationId
  )}/respond/`;
}

/** Оповещение управлений департамента о заявке (Plane №73, шаг СС-2). */
export function securityEventForcesNotifyPath(
  id: string,
  allocationId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/${encodeURIComponent(
    allocationId
  )}/notify/`;
}
/** Выделенные управлением люди у заявки департаменту (Plane №73, СС-3). */
export function securityEventForcesMembersPath(
  id: string,
  allocationId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/${encodeURIComponent(
    allocationId
  )}/members/`;
}
export function securityEventForcesMemberPath(
  id: string,
  allocationId: string,
  employeeId: string
): string {
  return `${securityEventForcesMembersPath(id, allocationId)}${encodeURIComponent(
    employeeId
  )}/`;
}
/** Отправка окончательного списка штабу и её отзыв (Plane №73, СС-4). */
export function securityEventForcesSubmitPath(
  id: string,
  allocationId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/${encodeURIComponent(
    allocationId
  )}/submit/`;
}
export function securityEventForcesWithdrawPath(
  id: string,
  allocationId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/${encodeURIComponent(
    allocationId
  )}/withdraw/`;
}
/** Решение штаба по присланному списку (Plane №73, СС-5). */
export function securityEventForcesAcceptPath(
  id: string,
  allocationId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/${encodeURIComponent(
    allocationId
  )}/accept/`;
}
export function securityEventForcesReturnPath(
  id: string,
  allocationId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/${encodeURIComponent(
    allocationId
  )}/return/`;
}
// `securityEventForcesCompletePath` СНЯТ вместе с ручкой (Plane №149).
export function securityEventPlacementAssignPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/assign/`;
}
export function securityEventPlacementUnassignPath(
  id: string,
  assignmentId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/${assignmentId}/`;
}
/**
 * Снятие ПУСТОГО поста с расчёта на этапе «Расстановка» (Plane №259).
 *
 * Путь идёт через `placement/posts/`, а не `placement/<id>`: второй занят
 * снятием НАЗНАЧЕНИЯ, и одиночный сегмент там съедается идентификатором
 * назначения.
 */
export function securityEventPlacementPostPath(
  id: string,
  postId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/posts/${encodeURIComponent(
    postId
  )}/`;
}
export function securityEventPlacementCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/complete/`;
}
export function securityEventApprovalRoutePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/route/`;
}
export function securityEventApproverPath(id: string, approverId: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/route/${encodeURIComponent(approverId)}/`;
}
export function securityEventApproverDecidePath(
  id: string,
  approverId: string
): string {
  return `${securityEventApproverPath(id, approverId)}decide/`;
}

/**
 * Адресат операции согласования (Plane №411, Ш-5 плана №385): согласуют
 * ОБЪЕКТ ПОСЕЩЕНИЯ, а не мероприятие. Не прислали — сервер возьмёт
 * единственный объект; при нескольких откажет с просьбой выбрать, а не
 * угадает: приписанное чужому объекту согласование потом не различить.
 */
export interface VisitObjectAddressed extends Record<string, unknown> {
  visitObjectId?: string;
}

export interface AddApproverRequest extends VisitObjectAddressed {
  name: string;
  unit: string;
  position: string;
}

export interface DecideApproverRequest extends VisitObjectAddressed {
  decision: "APPROVED" | "RETURNED";
  comment: string;
  /** Привязка замечания к посту при возврате (`[МД-07]`); не прислали — общее. */
  postId?: string | null;
  /** Срочно вручную; не прислали — сервер решит по дате ОМ (`[ВОЗ-02]`). */
  urgent?: boolean;
}

export function securityEventApproverMovePath(
  id: string,
  approverId: string
): string {
  return `${securityEventApproverPath(id, approverId)}move/`;
}

export interface MoveApproverRequest extends VisitObjectAddressed {
  direction: "UP" | "DOWN";
}

export function securityEventApprovalSendPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/send/`;
}
export function securityEventApprovalWithdrawPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/withdraw/`;
}
export function securityEventRemarkResolvePath(
  id: string,
  remarkId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/remarks/${encodeURIComponent(remarkId)}/resolve/`;
}

/**
 * Решение по замечанию (`[ВОЗ-04]`): «Устранено» — ответ необязателен;
 * «Не согласен» — обязателен; «Открыто» возвращает замечание в работу.
 */
export interface ResolveRemarkRequest extends VisitObjectAddressed {
  decision: ApprovalRemarkStatus;
  response?: string;
}

export function securityEventApprovalApprovePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/approve/`;
}
export function securityEventApprovalReturnPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/return/`;
}
// Раздельные сегменты ("acknowledge" vs "acknowledgement/complete") — иначе
// path-to-regexp у MSW матчит /acknowledgement/complete/ более ранним
// :assignmentId-роутом (assignmentId="complete") и отвечает не тот handler.
export function securityEventAcknowledgePath(
  id: string,
  assignmentId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/acknowledge/${assignmentId}/`;
}
export function securityEventAcknowledgementCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/acknowledgement/complete/`;
}

/** Рассылка уведомлений о заступлении: назначенным и их руководителям
 * (Plane №243). Отвечает ОТЧЁТОМ о рассылке, а не мероприятием: вопрос
 * кнопки — «кому ушло». */
export function securityEventAcknowledgementNotifyPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/acknowledgement/notify/`;
}

/** Напоминания этапа «Ознакомление» (Plane №432): одному и всем, кто не подтвердил. */
export function securityEventAcknowledgementRemindPath(id: string, assignmentId: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/acknowledgement/remind/${assignmentId}/`;
}

export function securityEventAcknowledgementRemindAllPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/acknowledgement/remind-all/`;
}

/** Завершение при неподтвердивших — только с `force` и комментарием (Plane №432). */
export interface CompleteAcknowledgementRequest extends Record<string, unknown> {
  force?: boolean;
  comment?: string;
}

export interface AcknowledgementNotifyReport {
  /** Всего адресатов: сотрудники плюс их руководители. */
  notified: number;
  employees: number;
  supervisors: number;
  /** Кому НЕ ушло: у кадровой записи нет связанной учётки. Поимённо, а не
   *  числом — иначе чинить это некому. */
  unlinkedEmployeeIds: string[];
  /** Кому напомнили (Plane №432); у рассылки этапа поля нет. */
  remindedAssignmentIds?: string[];
}
export function securityEventJournalPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/journal/`;
}
export function securityEventReplaceAssignmentPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/conduct/replace/`;
}
/** Закрыть ОБЪЕКТ посещения (`[ЗАК-05]`, Plane №404); последний закрытый
 *  закрывает мероприятие само (`[ЗАК-12]`). */
export function visitObjectClosePath(eventId: string, visitObjectId: string): string {
  return `${visitObjectsPath(eventId)}${visitObjectId}/close/`;
}

// ── Оценки этапа «Проведение» (`[МД-08]`/`[ЗАК-02]`, Plane №433) ──────────
/** Строка оценки: назначение объекта (или снятый заменой — `replaced`). */
export interface VisitEvaluationRow {
  assignmentId: string | null;
  postId: string | null;
  post: string;
  sector: string;
  employeeId: string | null;
  employeeName: string;
  divisionName: string;
  acknowledgedAt: string | null;
  replaced: boolean;
  /** null — не оценён; шкала 1–10. */
  score: number | null;
  comment: string;
}

export interface VisitEvaluationSummary {
  rows: VisitEvaluationRow[];
  evaluated: number;
  total: number;
  incidents: number;
}

export interface SetEvaluationRequest {
  assignmentId: string;
  /** null — снять оценку (повторный клик по цифре). */
  score: number | null;
  comment?: string;
}

export function visitObjectEvaluationsPath(eventId: string, visitObjectId: string): string {
  return `${visitObjectsPath(eventId)}${visitObjectId}/evaluations/`;
}

export function visitObjectEvaluationsAllPath(eventId: string, visitObjectId: string): string {
  return `${visitObjectEvaluationsPath(eventId, visitObjectId)}all/`;
}

export interface CloseVisitObjectRequest extends Record<string, unknown> {
  comment?: string;
}

export function securityEventClosePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/close/`;
}

/** Перевод ОМ на выбранный этап в обход условий — админ-полномочие
 * (`event.stage_override`), см. apps/ops/security_events.py::override_stage. */
export function securityEventStagePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/stage/`;
}

export interface OverrideStageRequest extends Record<string, unknown> {
  stage: SecurityEventStage;
}
