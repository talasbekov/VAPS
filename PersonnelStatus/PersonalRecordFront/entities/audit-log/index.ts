// Аудит раздела ОМ: read-only журнал действий. Записи создаёт сервер
// (мок-слой) при мутациях — фронт их только читает.
export interface OpsAuditLog {
  id: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string;
  createdAt: string;
}

export const OPS_AUDIT_LOGS_PATH = "/api/ops/audit-logs/";

export interface ListOpsAuditLogsResponse {
  results: OpsAuditLog[];
}

/**
 * Русские подписи действий журнала мутаций.
 *
 * До этого экран аудита печатал `log.action` как есть, моноширинным шрифтом:
 * человек читал `SECURITY_EVENT_PLACEMENT_BY_DEPUTY` вместо «Расстановка
 * изменена замещающим». Требование заказчика «все действия фиксируются в
 * журнале» было выполнено технически и не выполнено по сути — журнал читали
 * только те, кто помнит коды (Plane №46).
 *
 * КЛЮЧИ ЗЕРКАЛЯТ `ACTIONS` из `apps/operations/audit_service.py` — закрытый
 * мир кодов сервера. Полноту карты стережёт проба
 * `test_audit_action_labels_cover_every_action`: новое действие без подписи
 * краснит гейт, а не приезжает на экран машинной строкой.
 *
 * Подпись отвечает на вопрос «что произошло», а не «какая ручка вызвана»:
 * в ленте её читают вслух при разбирательстве.
 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  STATUS_CREATED: "Статус заведён",
  STATUS_UPDATED: "Статус изменён",
  STATUS_CANCELLED: "Статус отменён",
  STATUS_COMPLETED: "Статус завершён",
  STATUS_EXTENDED: "Статус продлён",
  STATUS_CLARIFICATION_RESOLVED: "Заглушка статуса уточнена",
  SECONDMENT_INITIATED: "Прикомандирование начато",
  SECONDMENT_RETURN_REQUESTED: "Запрошен возврат из прикомандирования",
  SECONDMENT_RETURNED: "Возврат из прикомандирования",
  EMPLOYEE_DISMISSED: "Сотрудник уволен",
  DAILY_SUBMISSION_SUBMITTED: "День сдан",
  DAILY_SUBMISSION_AMENDED: "Сданный день поправлен",
  TOMORROW_BLOCK_OVERRIDDEN: "Снят запрет правки на завтра",
  DAILY_SUMMARY_ASSEMBLED: "Сводка собрана из версий подразделений",
  DAILY_SUMMARY_REBUILT: "Сводка пересобрана взамен прежней",
  SUBMISSION_EXPORTED: "Выдана личная копия сданного дня",
  ATTACHMENT_UPLOADED: "Файл документа записан в хранилище",
  DOCUMENT_ISSUED: "Документ выпущен",
  DOCUMENT_SUPERSEDED: "Документ отозван взамен нового",
  DOCUMENT_DOWNLOADED: "Документ выдан на руки",
  PASSPORT_VERSION_PUBLISHED: "Версия паспорта опубликована",
  SECURITY_EVENT_CREATED: "Мероприятие заведено",
  SECURITY_EVENT_CLOSED: "Мероприятие закрыто",
  SECURITY_EVENT_DELETED: "Мероприятие удалено из реестра",
  STATUS_PARTICIPATIONS_PURGED: "Сняты участия удалённых мероприятий",
  SECURITY_EVENT_STAGE_OVERRIDDEN: "Этап переведён вручную",
  SECURITY_EVENT_ACKNOWLEDGEMENT_FORCED:
    "Ознакомление завершено без подтверждения всех (Plane №432)",
  SECURITY_EVENT_DEPUTY_ASSIGNED: "Назначен замещающий на объекте",
  SECURITY_EVENT_DEPUTY_REVOKED: "Замещающий на объекте снят",
  SECURITY_EVENT_PLACEMENT_BY_DEPUTY: "Расстановка изменена замещающим",
  PLACEMENT_COMPLETED_WITH_SHORTAGE: "Расстановка завершена с недобором",
  VISIT_OBJECT_CLOSED: "Объект посещения закрыт",
  VISIT_OBJECT_CHIEF_ASSIGNED: "Назначен старший объекта",
  SECURITY_EVENT_CHIEF_SET: "Назначен старший наряда",
  SECURITY_EVENT_DETAILS_UPDATED: "Изменены сведения бюллетеня",
  VISIT_OBJECT_CHIEF_REVOKED: "Старший объекта снят",
  PLACEMENT_SECTOR_SENIOR_SET: "Старший сектора назначен или снят",
  ACCESS_PERMISSION_SAVED: "Право заведено или изменено",
  ACCESS_ROLE_SAVED: "Роль заведена или изменена",
  ACCESS_ROLE_PERMISSIONS_CHANGED: "Состав прав роли изменён",
  ACCESS_ACCOUNT_SAVED: "Учётная запись заведена или изменена",
  ACCESS_ACCOUNT_PASSWORD_RESET: "Пароль учётной записи сброшен",
  ACCESS_ACCOUNT_PASSWORD_CHANGED: "Пароль изменён владельцем учётной записи",
  ACCESS_ROLE_GRANTED: "Роль выдана человеку",
  ACCESS_ROLE_REVOKED: "Роль снята с человека",
  DUTY_SHIFT_CREATED: "Смена дежурства заведена",
  DUTY_SHIFT_CANCELLED: "Смена дежурства отменена",
  SETTINGS_UPDATED: "Правило настроек изменено",
  DICTIONARY_ENTRY_CREATED: "Значение справочника заведено",
  DICTIONARY_ENTRY_SET_ACTIVE: "Значение справочника включено или выключено",
  DICTIONARY_ENTRY_UPDATED: "Значение справочника изменено",
  DICTIONARY_ENTRY_DELETED: "Значение справочника удалено",
  GVO_SUMMARY_PATCHED: "Сводка ГВО поправлена вручную",
  FORCE_ALLOCATION_NOTIFIED: "Управления оповещены о заявке на силы",
  FORCE_ALLOCATION_SPLIT: "Квота департамента разложена по управлениям",
  FORCE_ALLOCATION_SUBMITTED: "Список выделенных отправлен в штаб",
  FORCE_ALLOCATION_ACCEPTED: "Штаб принял список и передал людей мероприятию",
  FORCE_ALLOCATION_RETURNED: "Штаб вернул список департаменту",
  GVO_SUMMARY_RESET: "Ручная правка сводки ГВО сброшена",
};

/**
 * Подписи ТИПОВ СУЩНОСТЕЙ (Plane №69). Ключи зеркалят `ENTITY_TYPES` из
 * `apps/operations/audit_service.py`; полноту стережёт проба на стороне
 * сервера — там же, где растёт закрытый мир кодов.
 *
 * Колонка «Объект» печатала машинную строку `access_user_role · 12`, и
 * читать её вслух на разбирательстве было нечем.
 */
export const AUDIT_ENTITY_LABEL: Record<string, string> = {
  employee_status: "Статус сотрудника",
  secondment: "Прикомандирование",
  employee: "Сотрудник",
  daily_submission: "Сданный день",
  tomorrow_block_override: "Снятие запрета правки на завтра",
  attachment: "Вложение документа",
  issued_document: "Выпущенный документ",
  security_object: "Охраняемый объект",
  security_event: "Охранное мероприятие",
  duty_shift: "Смена дежурства",
  policy_setting: "Правило настроек",
  dictionary_entry: "Значение справочника",
  access_permission: "Право доступа",
  access_role: "Роль",
  access_account: "Учётная запись",
  access_user_role: "Назначение роли",
};

export function auditEntityLabel(entityType: string): string {
  return AUDIT_ENTITY_LABEL[entityType] ?? entityType;
}

export function isKnownAuditEntity(entityType: string): boolean {
  return entityType in AUDIT_ENTITY_LABEL;
}

/**
 * Подписи ПОЛЕЙ в старом и новом значении. Карта заведомо неполна и такой
 * задумана: журнал пишут два десятка сервисов, поля у них свои, и обещать
 * подпись каждому значило бы врать. Неизвестное поле печатается своим ключом
 * моноширинным — так видно, что подписи нет, а не что поле называется
 * странно (та же конвенция, что у неизвестного действия).
 */
export const AUDIT_FIELD_LABEL: Record<string, string> = {
  is_active: "Действует",
  code: "Код",
  name: "Название",
  description: "Описание",
  username: "Логин",
  email: "Почта",
  first_name: "Имя",
  last_name: "Фамилия",
  role_code: "Роль",
  user_id: "Пользователь",
  scope_division_id: "Область (подразделение)",
  permission_code: "Право",
  stage: "Этап",
  status: "Состояние",
  created: "Заведено впервые",
  reason: "Причина",
  comment: "Комментарий",
};

export interface AuditChange {
  key: string;
  /** Подпись поля; равна ключу, если подписи нет. */
  label: string;
  isKnownField: boolean;
  before: string | null;
  after: string | null;
}

/** Значение поля словами: `true/false` — «да/нет», пусто — «—». */
function readableValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? "—" : value.map(readableValue).join(", ");
  }
  // Вложенный объект остаётся JSON: разбирать его на поля вслепую значило бы
  // придумывать структуру, которой журнал не обещал.
  return JSON.stringify(value);
}

/**
 * Изменение по полям: что было и что стало, по одной строке на поле.
 *
 * Показываются ТОЛЬКО РАЗЛИЧИЯ. Строка «стало: {весь объект}» заставляла
 * читателя сравнивать два JSON глазами — а вопрос у него один: что именно
 * изменилось.
 */
export function auditChanges(
  oldValue: unknown,
  newValue: unknown
): AuditChange[] {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const before = isRecord(oldValue) ? oldValue : {};
  const after = isRecord(newValue) ? newValue : {};
  if (!isRecord(oldValue) && !isRecord(newValue)) return [];

  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changes: AuditChange[] = [];
  for (const key of keys.sort()) {
    const from = readableValue(before[key]);
    const to = readableValue(after[key]);
    // Поле, которое не менялось, в ленте — шум: строка «Название: Иванов →
    // Иванов» отнимает место у той, где действительно что-то произошло.
    if (key in before && key in after && from === to) continue;
    changes.push({
      key,
      label: AUDIT_FIELD_LABEL[key] ?? key,
      isKnownField: key in AUDIT_FIELD_LABEL,
      before: key in before ? from : null,
      after: key in after ? to : null,
    });
  }
  return changes;
}

/** Подпись действия; НЕИЗВЕСТНЫЙ код возвращается как есть — прятать его за
 * «прочее» значило бы скрыть от разбирательства, что именно произошло. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}

/** Знаем ли мы это действие. Экран печатает незнакомое моноширинным — так
 * видно, что подписи нет, а не что действие называется странно. */
export function isKnownAuditAction(action: string): boolean {
  return action in AUDIT_ACTION_LABEL;
}
