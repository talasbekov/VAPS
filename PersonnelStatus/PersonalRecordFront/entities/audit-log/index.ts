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
  SECURITY_EVENT_STAGE_OVERRIDDEN: "Этап переведён вручную",
  SECURITY_EVENT_DEPUTY_ASSIGNED: "Назначен замещающий на объекте",
  SECURITY_EVENT_DEPUTY_REVOKED: "Замещающий на объекте снят",
  SECURITY_EVENT_PLACEMENT_BY_DEPUTY: "Расстановка изменена замещающим",
  VISIT_OBJECT_CHIEF_ASSIGNED: "Назначен старший объекта",
  VISIT_OBJECT_CHIEF_REVOKED: "Старший объекта снят",
  PLACEMENT_SECTOR_SENIOR_SET: "Старший сектора назначен или снят",
  ACCESS_PERMISSION_SAVED: "Право заведено или изменено",
  ACCESS_ROLE_SAVED: "Роль заведена или изменена",
  ACCESS_ROLE_PERMISSIONS_CHANGED: "Состав прав роли изменён",
  ACCESS_ACCOUNT_SAVED: "Учётная запись заведена или изменена",
  ACCESS_ACCOUNT_PASSWORD_RESET: "Пароль учётной записи сброшен",
  DUTY_SHIFT_CREATED: "Смена дежурства заведена",
  DUTY_SHIFT_CANCELLED: "Смена дежурства отменена",
  SETTINGS_UPDATED: "Правило настроек изменено",
  DICTIONARY_ENTRY_CREATED: "Значение справочника заведено",
  DICTIONARY_ENTRY_SET_ACTIVE: "Значение справочника включено или выключено",
  DICTIONARY_ENTRY_DELETED: "Значение справочника удалено",
  GVO_SUMMARY_PATCHED: "Сводка ГВО поправлена вручную",
  FORCE_ALLOCATION_NOTIFIED: "Управления оповещены о заявке на силы",
  FORCE_ALLOCATION_SUBMITTED: "Список выделенных отправлен в штаб",
  FORCE_ALLOCATION_ACCEPTED: "Штаб принял список и передал людей мероприятию",
  FORCE_ALLOCATION_RETURNED: "Штаб вернул список департаменту",
  GVO_SUMMARY_RESET: "Ручная правка сводки ГВО сброшена",
};

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
