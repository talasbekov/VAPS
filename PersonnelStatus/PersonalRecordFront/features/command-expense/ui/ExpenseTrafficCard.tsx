"use client";

// «Расход дня: светофор сдачи» — командный центр смотрит на ТУ ЖЕ сдачу дня,
// что и аналитика (`useTrafficLightTree`, `/security-ops/analytics`) и борд
// «Ежедневного расхода»: счёт «Сдано / Не сдано / Просрочено» и контрольный
// час берутся из ЕЁ ответа (`GET traffic-light/tree/`, тот же ключ кэша
// ["traffic-light", "tree", "today"]).
//
// РАЗБОР КОРЗИН ЗДЕСЬ НЕ ЖИВЁТ — он в `entities/daily-grid`
// (`classifyLeaf` / `countSubmissions` / `trafficLeaves`), общий на все три
// экрана. До ревью ветки 22.08 каждый экран раскладывал ответ по корзинам
// сам, и слово «Сдано» значило три разных числа: опоздавший GREEN попадал
// здесь в «Просрочено», в аналитике — сразу в «сдали» И «с опозданием», в
// борде — в «Сдано». Прежняя шапка этого файла обещала, что «второго счёта
// здесь не заводится» — обещание было неправдой ровно потому, что счёт
// повторялся в трёх местах; теперь он один физически, а не по договорённости.
//
// Аналитика печатает БОЛЕЕ ДРОБНУЮ разбивку (RED против UNKNOWN, YELLOW
// внутри сдавших), но выводит её из ТЕХ ЖЕ корзин: её «сдали» — это ровно
// «Сдано» этой карточки на том же дереве.
//
// Список «отстающих» — ВЕРХНИЙ уровень дерева (parent_id === null), не
// листья: карточка командного центра — обзорная, показывает, в какой ветке
// смотреть, а поимённая детализация (расхождение, история) — на экране
// аналитики по ссылке ниже.
import { useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useTrafficLightTree } from "@/hooks/use-strength-report";
import { SUBMISSION_LABEL, countSubmissions } from "@/entities/daily-grid";

const CARD_LABEL = "Расход дня";

/** Потолок видимых строк списка отстающих. Карточка — обзорная (детализация
 * — на экране аналитики по ссылке), а структуре подразделений потолка нет:
 * без ограничения список раздулся бы вместе с числом подразделений и порвал
 * бы вёрстку командного центра (найдено ревью 21.08). 5 — влезает рядом со
 * счётчиками на этой карточке визуально не разрастаясь. */
const LAGGING_VISIBLE_LIMIT = 5;

/** «17:00:00» → «17:00». Тот же приём, что у `formatControlHour` в
 * аналитике: секунды порога сравнения суток не значат ничего, хвост нулей
 * только шумит.
 *
 * `null` — значение НЕВАЛИДНО (пусто, не строка формата HH:MM…) — тогда
 * вызывающий код печатает честную фразу «не задан», а не сырое значение:
 * эхо сырого `raw` при пустом/битом ответе рисовало бы на экране
 * «Контрольный час undefined —», что читается как баг компонента, а не как
 * честное «сервер не прислал час». (В `app/security-ops/analytics/page.tsx`
 * та же яма — `formatControlHour` там эхует сырое значение без проверки;
 * не трогаем чужой файл, см. отчёт задачи.) */
function formatControlHour(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  return /^\d{2}:\d{2}/.test(raw) ? raw.slice(0, 5) : null;
}

function GateCard({ children }: { children: React.ReactNode }) {
  return (
    <Card role="region" aria-label={CARD_LABEL}>
      <CardHeader>
        <CardTitle>{CARD_LABEL}: светофор сдачи</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function ExpenseTrafficCard() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  // Тот же код права, что у соседних показателей расхода на этом экране
  // (`canReadStrength`) и у светофора в аналитике — второго кода права для
  // той же ручки заводить нельзя.
  const canRead = hasPermission("status.view");
  const tree = useTrafficLightTree(!permissionsLoading && canRead);

  const derived = useMemo(() => {
    const data = tree.data;
    if (data === undefined) return null;
    // Счёт — общей функцией раздела: по ЛИСТЬЯМ леса (цвет узла с потомками
    // — худший в поддереве, каскад светофора; сложение родителя с детьми
    // посчитало бы подразделение дважды), листья берутся из ЛЕСА, а не
    // наивным «кто ни у кого не родитель» — иначе пара узлов, замкнутых в
    // цикл `parent_id`, выпадала бы из счёта молча.
    const counts = countSubmissions(data.nodes);
    const lagging = data.nodes.filter(
      (node) =>
        node.parent_id === null &&
        (node.status === "RED" || node.status === "YELLOW")
    );
    // Порядок: сперва просроченные (`late`) — они срочнее, значит хвост при
    // обрезке обязан состоять из МЕНЕЕ срочных, а не из случайных узлов.
    // Внутри каждой группы порядок — КАК ПРИШЁЛ С СЕРВЕРА (устойчивый
    // filter, свой порядок не выдумывается). RED структурно никогда не
    // late (см. `classifyLeaf` в `entities/daily-grid`), поэтому
    // «просроченные» здесь — это всегда YELLOW-узлы с `late: true`.
    const overdue = lagging.filter((node) => node.late);
    const rest = lagging.filter((node) => !node.late);
    const orderedLagging = [...overdue, ...rest];
    const visibleLagging = orderedLagging.slice(0, LAGGING_VISIBLE_LIMIT);
    const hiddenLaggingCount = orderedLagging.length - visibleLagging.length;
    return { data, counts, visibleLagging, hiddenLaggingCount };
  }, [tree.data]);

  // Нет права — карточки нет вовсе, как у соседних гейтов страницы
  // (событийный гейт всей страницы, `OpsAccessDenied`): молчаливая пустота
  // здесь предпочтена «нужно право …», потому что это ОДНА карточка в
  // сетке, а не весь экран, и объяснение недоступности одной плитки среди
  // прочих шумело бы больше, чем помогало.
  if (!permissionsLoading && !canRead) return null;

  if (permissionsLoading || (canRead && tree.isPending)) {
    return (
      <GateCard>
        <p className="text-sm text-muted-foreground">Загрузка светофора…</p>
      </GateCard>
    );
  }

  if (tree.isError || derived === null) {
    return (
      <GateCard>
        <p className="text-sm text-muted-foreground">Светофор сейчас недоступен.</p>
      </GateCard>
    );
  }

  const { data, counts, visibleLagging, hiddenLaggingCount } = derived;
  const controlHour = formatControlHour(data.control_hour);

  return (
    <Card role="region" aria-label={CARD_LABEL}>
      <CardHeader>
        <CardTitle>{CARD_LABEL}: светофор сдачи</CardTitle>
        <p className="text-xs text-muted-foreground">
          {controlHour !== null
            ? `Контрольный час ${controlHour} — сдача после него считается опозданием.`
            : "Контрольный час не задан."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div data-metric="submitted">
            <StatCard
              label="Сдано"
              value={counts.submitted}
              tone="success"
              caption="Подразделений сдали вовремя"
            />
          </div>
          <div data-metric="missing">
            <StatCard
              label="Не сдано"
              value={counts.missing}
              tone="danger"
              caption="Сдачи за сегодня нет"
            />
          </div>
          <div data-metric="late">
            <StatCard
              label="Просрочено"
              value={counts.late}
              tone="warning"
              caption="Сдали после контрольного часа"
            />
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            Отстающие департаменты
          </p>
          {visibleLagging.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Отстающих департаментов нет.
            </p>
          ) : (
            <ul className="space-y-1">
              {visibleLagging.map((node) => (
                <li
                  key={node.division_id}
                  className="flex flex-wrap items-baseline gap-2 border-b py-1 text-xs last:border-0"
                >
                  <span className="flex-1 truncate font-medium">
                    {node.name}
                  </span>
                  <span className="text-muted-foreground">
                    {SUBMISSION_LABEL[node.status]}
                  </span>
                  {node.late && (
                    <span className="text-muted-foreground">с опозданием</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {/* Ссылка на аналитику — ОДНА на карточку: если хвост обрезан,
              она встраивается в саму строку хвоста («и ещё K — в
              аналитике»), а не дублируется отдельной строкой ниже. */}
          {hiddenLaggingCount > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              и ещё {hiddenLaggingCount} —{" "}
              <Link
                href="/security-ops/analytics"
                className="text-primary underline-offset-2 hover:underline"
              >
                в аналитике
              </Link>
            </p>
          ) : (
            <Link
              href="/security-ops/analytics"
              className="mt-2 inline-block text-xs text-primary underline-offset-2 hover:underline"
            >
              Открыть светофор в аналитике
            </Link>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button variant="outline" disabled>
            Напомнить департаментам
          </Button>
          <p className="text-xs text-muted-foreground">
            Рассылка идёт автоматически к контрольному часу; ручная —
            бэк-этапом.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
