type CapabilityNote = { code: string; label: string; reason?: string };

// The API retains detailed implementation rationale. Screens explain the
// consequence for the user's task, without exposing internal specification text.
const descriptions: Record<string, string> = {
  EVALUATOR_WEIGHTS: 'Все учтённые оценки имеют одинаковый вес.',
  GROUP_EVALUATION: 'Распределение групповой оценки в этом представлении недоступно.',
  DUTY_SHIFTS: 'Дежурства учитываются отдельно от оперативного рейтинга.',
  SERVICE_HOURS: 'Продолжительность службы не входит в расчёт рейтинга.',
  OWN_RATING: 'Личный рейтинг в этом представлении недоступен.',
  SENSITIVE_EVALUATIONS: 'Здесь доступен общий результат, без раскрытия отдельных оценок.',
  RATING_DYNAMICS_FORECAST: 'График показывает сохранённые результаты без прогнозирования.',
  FORBIDDEN_BY_2216: 'Аналитика показывает результаты групп без раскрытия индивидуальных оценок.',
  PROTOTYPE_METRICS_REMOVED: 'Используйте распределение по диапазонам оценок.',
  NO_OVERALL_MEAN: 'Общее среднее скрыто, чтобы сохранить конфиденциальность малых групп.',
  REPLACED_BEFORE_START: 'Оценить можно только сотрудника с подтверждённым участием.',
  ARCHIVE_ADDENDUM: 'Архивные дополнения к исправлениям пока недоступны.',
  CORRECT_FOREIGN_EVALUATION: 'Исправлять можно собственные оценки при наличии соответствующего права.',
  RECOGNITION_AND_REMARK: 'Благодарности и замечания не определяются по величине оценки.',
  BULK_DEFAULT: 'Проверьте и оцените каждого участника отдельно.',
  RECEIVED_EVALUATIONS: 'Здесь показаны ваши задания и отправленные вами оценки.',
  SENSITIVE_COLUMNS: 'Содержание отдельных оценок и сведения об оценщиках закрыты.',
  RECOGNITION_FILTERS: 'Фильтры по благодарностям и замечаниям пока недоступны.',
  DOCUMENT_FILTER: 'Вложения к оценкам и поиск по ним пока недоступны.',
  SERVICE_RESULT: 'Результат оценивания и время службы учитываются отдельно.',
  AUDIT_SENSITIVE_VALUES: 'Журнал не раскрывает содержание отдельных оценок.',
  AUDIT_EXPORT: 'Выгрузка журнала оценивания пока недоступна.',
  AGGREGATE_UPDATED_NOTICE: 'Уведомления об обновлении итоговой сводки пока не отправляются.',
  EMPLOYEE_NOTICE: 'Уведомления оцениваемому сотруднику пока не отправляются.',
  XLSX: 'Для этой выгрузки доступен CSV, который можно открыть в Excel.',
  PDF: 'Для этой выгрузки доступен CSV. Печатные документы формируются отдельно.',
  DOCX: 'DOCX доступен для документов по мероприятию, но не для этого отчёта за период.',
  INDIVIDUAL: 'Выгружается общая сводка без отдельных оценок и комментариев.',
  NOTE: 'Личные комментарии к дежурству по умолчанию скрыты в отчёте.',
  OVERRIDE_REASON: 'Внутренние обоснования исключений по умолчанию скрыты в отчёте.',
  SOURCE_WATERMARK: 'CSV не содержит водяного знака.',
};

const labels: Record<string, string> = {
  OWN_RATING: 'Личный рейтинг',
  CORRECT_FOREIGN_EVALUATION: 'Исправление чужой оценки',
  SENSITIVE_COLUMNS: 'Подробности отдельных оценок',
  INDIVIDUAL: 'Индивидуальные оценки',
  PROTOTYPE_METRICS_REMOVED: 'Показатели распределения',
};

const internalOnly = new Set(['SCOPE', 'SCOPE_SNAPSHOT', 'POLICY_VERSION', 'ARTIFACT_ROUTE']);

export function CapabilityNotes({ items, title = 'Возможности и ограничения' }: {
  items: CapabilityNote[];
  title?: string;
}) {
  const visible = items.filter(item => !internalOnly.has(item.code));
  if (visible.length === 0) return null;
  return (
    <details className="rounded-xl border bg-card p-4">
      <summary className="cursor-pointer text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        {title}
      </summary>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        {visible.map(item => (
          <li key={item.code}>
            <span className="font-medium text-foreground">{labels[item.code] ?? item.label}</span>
            {descriptions[item.code] && <> — {descriptions[item.code]}</>}
          </li>
        ))}
      </ul>
    </details>
  );
}
