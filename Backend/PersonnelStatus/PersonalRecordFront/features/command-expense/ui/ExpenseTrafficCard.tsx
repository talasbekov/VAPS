"use client";

// «Расход дня: светофор сдачи» — командный центр смотрит на ТУ ЖЕ сдачу дня,
// что и аналитика (`useTrafficLightTree`, `/security-ops/analytics`): счёт
// «Сдано / Не сдано / Просрочено» и контрольный час берутся из ЕЁ ответа
// (`GET traffic-light/tree/`, тот же ключ кэша ["traffic-light", "tree",
// "today"]), второго счёта здесь не заводится — иначе цифры разошлись бы с
// экраном светофора при первом же расхождении.
//
// СЧЁТ — ПО ЛИСТЬЯМ ДЕРЕВА (узлы без потомков), тем же приёмом, что и у
// DaySubmissionSection в аналитике: цвет узла С ПОТОМКАМИ — худший в
// поддереве (каскад светофора, organization_management/apps/operations/
// traffic_light.py::traffic_light_tree), и суммировать родителя с детьми
// значило бы посчитать одно подразделение дважды.
//
// СЛОВАРЬ СТАТУСА НЕ ТРЁХЗНАЧЕН (GREEN/YELLOW/RED/NEUTRAL/UNKNOWN + булев
// `late`), А ЗДЕСЬ НУЖНО ТРИ СЧЁТЧИКА — маппинг установлен по бэку, а не
// придуман на глаз (см. traffic_light.py, DivisionTrafficLight.late и
// _own_states):
//
//   * `late` — отметка опоздания САМОЙ СДАЧИ (`submission.late`), а не
//     свойство цвета. У узла БЕЗ сдачи (RED — «есть кого сдавать, не
//     сдали», NEUTRAL — «сдавать некого») сдачи нет вовсе, и бэк
//     жёстко возвращает `late=False` — опаздывать нечему. Поэтому
//     «Просрочено» — это НЕ «красный, у которого истёк час», а «сдали,
//     но после контрольного часа»;
//   * Сдано      = статус GREEN|YELLOW и НЕ late — сдали вовремя. YELLOW
//     («сдан, данные разошлись» — подпись аналитики) это тоже СДАЧА, а не
//     её отсутствие: расхождение с живыми данными не значит, что дня не
//     было;
//   * Просрочено = статус GREEN|YELLOW и late — сдали, но после
//     контрольного часа;
//   * Не сдано   = статус RED (сдачи нет) ИЛИ UNKNOWN (справочник узла
//     сломан — свод считает «не знаю» СТАРШЕ красного, см. `_PRECEDENCE`
//     traffic_light.py: «не знаю» честнее, чем «всё в порядке», и класть
//     сломанный узел в «Сдано» значило бы обвинить отчёт зелёным цветом);
//   * NEUTRAL (сдавать некого) — вне трёх счётчиков: это не факт сдачи, а
//     отсутствие обязанности сдавать.
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
import type { TrafficLightNode } from "@/lib/api";

const CARD_LABEL = "Расход дня";

/** «17:00:00» → «17:00». Тот же приём, что у `formatControlHour` в
 * аналитике: секунды порога сравнения суток не значат ничего, хвост нулей
 * только шумит. Нечитаемое значение возвращается как есть. */
function formatControlHour(raw: string): string {
  return /^\d{2}:\d{2}/.test(raw) ? raw.slice(0, 5) : raw;
}

/** Подписи цветов светофора — ДОСЛОВНО те же, что в аналитике
 * (`SUBMISSION_LABEL`, app/security-ops/analytics/page.tsx): второй словарь
 * с другими словами для тех же пяти статусов разошёлся бы с ней при первом
 * же новом состоянии. */
const SUBMISSION_LABEL: Record<TrafficLightNode["status"], string> = {
  GREEN: "сдан",
  YELLOW: "сдан, данные разошлись",
  RED: "не сдан",
  NEUTRAL: "нечего сдавать",
  UNKNOWN: "состояние неизвестно",
};

type SubmissionBucket = "submitted" | "late" | "missing";

/** Три состояния сдачи листа. NEUTRAL — не факт сдачи, а её отсутствие как
 * обязанности; в трёх счётчиках не участвует (см. докстринг файла). */
function classify(node: TrafficLightNode): SubmissionBucket | null {
  if (node.status === "RED" || node.status === "UNKNOWN") return "missing";
  if (node.status === "GREEN" || node.status === "YELLOW") {
    return node.late ? "late" : "submitted";
  }
  return null;
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
    const parents = new Set(
      data.nodes
        .map((node) => node.parent_id)
        .filter((id): id is number => id !== null)
    );
    const leaves = data.nodes.filter((node) => !parents.has(node.division_id));
    const counts: Record<SubmissionBucket, number> = {
      submitted: 0,
      late: 0,
      missing: 0,
    };
    for (const node of leaves) {
      const bucket = classify(node);
      if (bucket !== null) counts[bucket] += 1;
    }
    const lagging = data.nodes.filter(
      (node) =>
        node.parent_id === null &&
        (node.status === "RED" || node.status === "YELLOW")
    );
    return { data, counts, lagging };
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

  const { data, counts, lagging } = derived;

  return (
    <Card role="region" aria-label={CARD_LABEL}>
      <CardHeader>
        <CardTitle>{CARD_LABEL}: светофор сдачи</CardTitle>
        <p className="text-xs text-muted-foreground">
          Контрольный час {formatControlHour(data.control_hour)} — сдача
          после него считается опозданием.
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
          {lagging.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Отстающих департаментов нет.
            </p>
          ) : (
            <ul className="space-y-1">
              {lagging.map((node) => (
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
          <Link
            href="/security-ops/analytics"
            className="mt-2 inline-block text-xs text-primary underline-offset-2 hover:underline"
          >
            Открыть светофор в аналитике
          </Link>
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
