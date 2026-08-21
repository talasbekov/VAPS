// Три вкладки паспорта из прототипа, которым не нашлось живого источника —
// «Инфраструктура», «Чек-лист» и «Привлекаемые группы»
// (`Прототип/Объекты.dc.html`, экран `scrPass`, секции `tInfra`/`tCheck`/
// `tGroups`, строки 185–262; заголовок вкладок и их состав — строка 532).
//
// Раньше эти три вкладки не рисовались вовсе — назывались только в списке
// «Чего в этом паспорте нет» под формой. Теперь у каждой свой макет:
// структура секций и заголовки — как в прототипе (категории инфраструктуры,
// блок контрольных вопросов, карточки привлекаемых групп), а вместо
// значений — плейсхолдер-полосы `bg-muted` и ОДНА честная строка причины.
// Строка объясняет отсутствие СВОИМИ словами экрана, а не сервера: у этих
// трёх блоков нет ни ручки, ни модели, спросить сервер не о чем.
//
// Категории и подписи ниже — СТРУКТУРА прототипа (заголовки секций,
// подписи полей), а не данные конкретного объекта: сами значения (список
// входов, тексты вопросов чек-листа, названия привлечённых групп) в
// прототипе — демонстрационные примеры для вымышленного объекта, и
// показывать их как будто настоящие для любого реального объекта было бы
// подлогом. Поэтому значения — только плейсхолдер-полосы.
import { Construction } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const INFRA_GAP_LINE =
  "Входы и выходы, транспорт, вертикальные коммуникации, инженерные системы, уязвимые места и ремонтные работы объекта в модели не хранятся — ни таблиц, ни ручек нет; появится бэк-этапом.";

export const CHECK_GAP_LINE =
  "Контрольных вопросов, ответов «да / нет / не применимо» и решения по расчёту постов в бэке нет — дата проверки в шапке паспорта считается политикой свежести от последней публикации, а не от пройденного чек-листа; появится бэк-этапом.";

export const GROUPS_GAP_LINE =
  "Кинологическая, инженерно-сапёрная, группа быстрого реагирования и подобные привлекаемые группы у объекта не заведены: такие силы живут в мероприятии, а не в паспорте объекта; появится бэк-этапом.";

// Заголовки категорий — из `infraCats` прототипа (строки 486–493). Сами
// пункты внутри категорий (конкретные входы, лифты, камеры) — демонстрация
// для примерного объекта, здесь не воспроизводятся.
const INFRA_CATEGORIES = [
  "Входы и выходы",
  "Транспорт и подъезды",
  "Вертикальные коммуникации",
  "Инженерные системы",
  "Уязвимые места",
  "Текущие ремонтные работы",
] as const;

// Подписи статов из правой панели `tCheck` прототипа (строка 214).
const CHECK_STATS = ["Последняя проверка", "Вопросов в чек-листе"] as const;

// Ширины плейсхолдер-полос чередуются, чтобы блок не читался одной сплошной
// плашкой, — исключительно вёрстка, значения по-прежнему не подставляются.
const BAR_WIDTHS = ["w-full", "w-5/6", "w-2/3", "w-3/4"] as const;

function PlaceholderBar({ index = 0 }: { index?: number }) {
  return (
    <div
      className={`h-3 rounded bg-muted ${BAR_WIDTHS[index % BAR_WIDTHS.length]}`}
      aria-hidden
    />
  );
}

function PlannedBadge() {
  return (
    <Badge variant="secondary" className="mb-3 gap-1">
      <Construction aria-hidden className="h-3 w-3" />
      Макет по прототипу
    </Badge>
  );
}

function InfraTabContent() {
  return (
    <div>
      <PlannedBadge />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {INFRA_CATEGORIES.map((title) => (
          <Card key={title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <PlaceholderBar index={0} />
              <PlaceholderBar index={1} />
              <PlaceholderBar index={2} />
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{INFRA_GAP_LINE}</p>
    </div>
  );
}

function CheckTabContent() {
  return (
    <div>
      <PlannedBadge />
      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Контрольные вопросы</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="flex items-center gap-3">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {n}
                </span>
                <PlaceholderBar index={n} />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Проверка объекта</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {CHECK_STATS.map((label) => (
              <div key={label} className="rounded-md border p-2.5">
                <p className="text-[10.5px] text-muted-foreground">{label}</p>
                <div className="mt-1.5 h-3 w-16 rounded bg-muted" aria-hidden />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{CHECK_GAP_LINE}</p>
    </div>
  );
}

function GroupsTabContent() {
  return (
    <div>
      <PlannedBadge />
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((n) => (
          <Card key={n}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="flex-1">
                <PlaceholderBar index={n} />
                <div className="mt-2 h-3 w-full rounded bg-muted" aria-hidden />
              </div>
              <div
                className="h-5 w-16 shrink-0 rounded-full bg-muted"
                aria-hidden
              />
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{GROUPS_GAP_LINE}</p>
    </div>
  );
}

export type PlannedTabKind = "infra" | "check" | "groups";

interface PassportPlannedTabsProps {
  kind: PlannedTabKind;
}

/**
 * Одна из трёх макетных вкладок паспорта. Выбор — через `kind`, а не через
 * собственное чтение адресной строки: какая вкладка активна и надо ли её
 * прятать `hidden`, решает страница паспорта — этот компонент только рисует
 * содержимое.
 */
export function PassportPlannedTabs({ kind }: PassportPlannedTabsProps) {
  if (kind === "infra") return <InfraTabContent />;
  if (kind === "check") return <CheckTabContent />;
  return <GroupsTabContent />;
}
