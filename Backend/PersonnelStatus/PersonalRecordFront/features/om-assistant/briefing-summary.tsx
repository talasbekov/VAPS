import type { AssistantBriefing, AssistantBriefingPending } from "@/features/om-assistant/model";

const unknown = "Нужно уточнить";
const count = (value: number | null | undefined) => value == null ? unknown : String(value);
const people = (value: number | null | undefined) => value == null ? unknown : `${value} чел.`;
const checklistLabels = ["Подъездные пути и парковка", "Периметр и ограждение", "Входные группы и КПП", "Пути эвакуации", "Связь и электропитание"];
const checkStates = { NORMAL: "Норма", REMARK: "Замечание", UNCHECKED: "Не проверено" };
const pendingLabels: Record<string, string> = {
  visit_object_add: "Добавить объект в ОМ", visit_object_chief: "Назначить старшего объекта",
  recon: "Сохранить расчёт и результаты осмотра", checklist: "Уточнить результаты чек-листа",
  existing_event: "Проверить изменения в карточке ОМ",
};

/** A read-only account of the instruction; official recon results stay in the event card. */
export function AssistantBriefingSummary({ briefing, pending, questions = [] }: {
  briefing?: AssistantBriefing | null; pending?: AssistantBriefingPending[] | null;
  questions?: { field: string; text: string }[];
}) {
  const objects = briefing?.objects ?? [];
  const persons = briefing?.protectedPersons ?? [];
  const pendingSteps = pending ?? [];
  const issues = briefing?.issues?.filter(issue => !questions.some(question => question.text === issue.text)) ?? [];
  if (!objects.length && !persons.length && !issues.length && !pendingSteps.length) return null;
  return <section aria-label="Объекты и охраняемые лица поручения" className="mt-4 space-y-4 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700">
    <div><h3 className="font-semibold">Распознанные сведения поручения</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">Потребность и чек-лист указаны со слов инициатора. Это не подтверждает завершение рекогносцировки и публикацию потребности в карточке ОМ.</p>
    </div>
    {objects.length > 0 && <div className="space-y-2">
      <h4 className="font-semibold">Объекты ({objects.length})</h4>
      {objects.map((object, index) => <details key={index} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <summary className="cursor-pointer break-words font-medium">
          <span>{object.name || unknown}</span><span className={`ml-3 ${object.needStatus === "unknown" ? "text-amber-800 dark:text-amber-200" : "text-slate-600 dark:text-slate-300"}`}>
            {object.needStatus === "known" ? people(object.personnelNeed) : unknown}
          </span>
        </summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div><dt className="text-slate-500">Старший объекта</dt><dd className="break-words font-medium">{object.chiefName || unknown}</dd></div>
          <div><dt className="text-slate-500">Секторов</dt><dd className="font-medium">{count(object.sectorCount)}</dd></div>
          <div><dt className="text-slate-500">Чек-лист со слов инициатора</dt><dd className="font-medium">{object.checklistChecked === true ? "Проверен" : object.checklistChecked === false ? "Не проверен" : unknown}</dd></div>
        </dl>
        {!!object.checklistResults?.length && <div className="mt-3 border-t pt-3">
          <h5 className="font-semibold">Результаты чек-листа со слов инициатора</h5>
          <ul className="mt-2 space-y-2">{object.checklistResults.map((result, resultIndex) => {
            const number = /^checklist-(\d+)$/.exec(result.id)?.[1];
            const title = number === undefined ? "Пункт чек-листа" : checklistLabels[Number(number)] ?? "Пункт чек-листа";
            return <li key={resultIndex}><p>{title}: {checkStates[result.state] ?? unknown}</p>
              {result.comment && <p className="mt-1 whitespace-pre-wrap break-words text-slate-500">{result.comment}</p>}</li>;
          })}</ul>
        </div>}
        {object.sectors.length > 0 && <ol className="mt-3 space-y-3 border-t pt-3" aria-label={`Структура объекта ${object.name}`}>
          {object.sectors.map((sector, sectorIndex) => <li key={sectorIndex}>
            <p className="font-medium">Сектор {sector.number}</p><p className="text-slate-500">Постов: {count(sector.postCount)}</p>
            {sector.posts.length > 0 && <ol className="mt-2 space-y-2 border-l border-slate-200 pl-3 dark:border-slate-700">
              {sector.posts.map((post, postIndex) => <li key={postIndex}>
                <p>Пост {post.number} · Потребность: {people(post.need)}</p><p className="text-slate-500">Подпостов: {count(post.subpostCount)}</p>
                {!!post.subposts?.length && <ol className="mt-1 space-y-1 pl-3">{post.subposts.map((subpost, subpostIndex) =>
                  <li key={subpostIndex}>Подпост {subpost.number}: {people(subpost.need)}</li>)}</ol>}
              </li>)}
            </ol>}
          </li>)}
        </ol>}
      </details>)}
    </div>}
    {persons.length > 0 && <div><h4 className="font-semibold">Охраняемые лица</h4>
      <ul className="mt-2 space-y-2">{persons.map((person, index) => <li key={index} className="break-words rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
        <p className="font-medium">{[person.code ? `Код ${person.code}` : null, person.name].filter(Boolean).join(" · ") || unknown}</p>
        {person.country && <p>Страна: {person.country}</p>}
        {person.createIfMissing !== undefined && <p className="mt-1 text-xs text-slate-500">Создать при отсутствии: {person.createIfMissing ? "разрешено инициатором" : "не разрешено"}</p>}
      </li>)}</ul>
    </div>}
    {issues.length > 0 && <div><h4 className="font-semibold">Требует уточнения</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5">{issues.map((issue, index) => <li key={index}>{issue.text}</li>)}</ul>
    </div>}
    {pendingSteps.length > 0 && <div className="rounded-lg border border-amber-200 p-3 dark:border-amber-800">
      <h4 className="font-semibold">Ожидают выполнения</h4>
      <ul className="mt-2 space-y-2">{pendingSteps.map((step, index) => {
        const objectName = (step.objectId ? objects.find(object => object.objectId === step.objectId)?.name : null) || step.objectName;
        const action = pendingLabels[step.action] ?? (/^[a-z_]+$/.test(step.action) ? "Проверить действие в карточке ОМ" : step.action);
        return <li key={index}><p className="font-medium">{objectName ? `${objectName}: ` : ""}{action}</p>
          <p className="mt-1 text-slate-500">{step.reason}</p></li>;
      })}</ul>
    </div>}
  </section>;
}
