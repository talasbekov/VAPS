"use client";

// Обратная связь (§28): реестр обращений со сводкой, поиском, фильтрами и
// страницами + форма нового обращения. Экран ничего не решает про видимость:
// кто какие обращения и поля видит, считает сервер — закрытое содержание
// приходит null вместе с причиной.
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import {
  useCreateFeedback,
  useFeedbackRequests,
  useSubmitFeedback,
} from "@/hooks/use-ops-feedback";
import { PORT_VERSION } from "@/entities/ops-changelog";
import type {
  FeedbackAttachmentMeta,
  FeedbackPriorityCode,
  FeedbackStatusCode,
  FeedbackTypeCode,
} from "@/entities/ops-feedback";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { MODULE_PERMISSION } from "@/entities/portal-access";
import { useDebouncedCommit } from "@/hooks/use-debounced-commit";

function formatMoment(iso: string): string {
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  return `${(bytes / 1024).toFixed(1)} КБ`;
}

const ALL = "ALL";

export default function FeedbackPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [typeCode, setTypeCode] = useState<string>(ALL);
  const [statusCode, setStatusCode] = useState<string>(ALL);
  const [moduleCode, setModuleCode] = useState<string>(ALL);
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);

  const listQuery = useFeedbackRequests({
    search,
    typeCode: typeCode === ALL ? undefined : (typeCode as FeedbackTypeCode),
    statusCode: statusCode === ALL ? undefined : (statusCode as FeedbackStatusCode),
    moduleCode: moduleCode === ALL ? undefined : moduleCode,
    page,
    mine,
  });
  const data = listQuery.data;
  const registry = data?.registry;

  const [formKey, setFormKey] = useState(1);
  const createFeedback = useCreateFeedback(() => {
    // Сброс формы — сменой key поддерева, а не setState в эффекте.
    setFormKey((value) => value + 1);
    setPage(1);
  });
  const submitDraft = useSubmitFeedback();

  function labelOf(kind: "type" | "priority" | "status", code: string): string {
    if (registry === undefined) return code;
    const source =
      kind === "type"
        ? registry.types
        : kind === "priority"
          ? registry.priorities
          : registry.statuses;
    return source.find((entry) => entry.code === code)?.label ?? code;
  }

  function moduleLabel(code: string): string {
    return registry?.modules.find((entry) => entry.moduleCode === code)?.label ?? code;
  }

  /** Любая смена условий отбора возвращает на первую страницу. */
  function changeFilter(apply: () => void): void {
    apply();
    setPage(1);
  }

  // `search` уходит прямо в queryKey — без задержки каждая буква была отдельным
  // запросом к реестру обращений.
  const [searchDraft, setSearchDraft] = useDebouncedCommit(search, (value) =>
    changeFilter(() => setSearch(value))
  );

  if (!permissionsLoading && !hasPermission(MODULE_PERMISSION["/feedback"])) {
    return <OpsAccessDenied what="обращений" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div>
          <PageHeader
            eyebrow="Обратная связь"
            title="Обратная связь"
            description="Обращения пользователей: ошибки, неверные данные, UX, идеи, доступ и помощь."
          />
          <p className="text-sm text-muted-foreground">
            <Link className="underline" href="/security-ops/changelog">
              Журнал исправлений
            </Link>
          </p>
        </div>

        {listQuery.isError && (
          <LoadFailure
            what="обращения"
            onRetry={() => void listQuery.refetch()}
            isRetrying={listQuery.isFetching}
          />
        )}

        {data !== undefined && registry !== undefined && (
          <section
            role="group"
            aria-label="Сводка по статусам"
            className="rounded-xl border bg-card p-4"
          >
            <h2 className="mb-2 text-sm font-semibold">Сводка по статусам</h2>
            {/* Сводку считает сервер по всему видимому набору. */}
            <ul className="flex flex-wrap gap-2">
              {data.stats.byStatus.map((entry) => (
                <li
                  key={entry.statusCode}
                  className="rounded-lg border px-2.5 py-1 text-xs text-muted-foreground"
                >
                  <span className="font-semibold text-foreground">
                    {labelOf("status", entry.statusCode)}
                  </span>{" "}
                  <span className="tabular-nums">{entry.count}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Всего доступно обращений: {data.stats.total}. Справочник{" "}
              {registry.registryVersion}.
            </p>
          </section>
        )}

        {registry !== undefined && (
          <FeedbackForm
            key={formKey}
            modules={registry.modules}
            types={registry.types}
            priorities={registry.priorities}
            relatedRoute={pathname}
            serverTime={data?.serverTime ?? null}
            pending={createFeedback.isPending}
            errorMessage={createFeedback.error?.message ?? null}
            onSubmit={(body) => createFeedback.mutate(body)}
          />
        )}

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Реестр обращений</h2>

          <div
            role="group"
            aria-label="Фильтры реестра"
            className="mb-3 flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-col gap-1 text-xs font-semibold">
              Поиск
              <input
                aria-label="Поиск по обращениям"
                className="rounded-md border bg-background p-2 text-sm font-normal"
                value={searchDraft}
                placeholder="Тема или описание"
                onChange={(event) => setSearchDraft(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              Тип
              <select
                aria-label="Фильтр по типу"
                className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
                value={typeCode}
                onChange={(event) => changeFilter(() => setTypeCode(event.target.value))}
              >
                <option value={ALL}>Все типы</option>
                {registry?.types.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              Статус
              <select
                aria-label="Фильтр по статусу"
                className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
                value={statusCode}
                onChange={(event) =>
                  changeFilter(() => setStatusCode(event.target.value))
                }
              >
                <option value={ALL}>Все статусы</option>
                {registry?.statuses.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              Модуль
              <select
                aria-label="Фильтр по модулю"
                className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
                value={moduleCode}
                onChange={(event) =>
                  changeFilter(() => setModuleCode(event.target.value))
                }
              >
                <option value={ALL}>Все модули</option>
                {registry?.modules.map((entry) => (
                  <option key={entry.moduleCode} value={entry.moduleCode}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold">
              <input
                type="checkbox"
                checked={mine}
                onChange={(event) => changeFilter(() => setMine(event.target.checked))}
              />
              Только мои
            </label>
          </div>

          {data === undefined ? (
            <p className="text-sm text-muted-foreground">Загрузка реестра…</p>
          ) : data.totalVisible === 0 ? (
            // «Ничего не нашлось» и «обращений ещё нет» — разные сообщения.
            <p className="text-sm text-muted-foreground">Обращений пока нет.</p>
          ) : data.results.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              По заданным условиям ничего не нашлось. Доступно обращений:{" "}
              {data.totalVisible}.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.results.map((request) => (
                <li key={request.feedbackId} className="rounded-lg border p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                      {labelOf("status", request.statusCode)}
                    </span>
                    <Link
                      className="text-sm font-semibold text-primary-ink underline"
                      href={`${pathname.replace(/\/+$/, "")}/${request.feedbackId}`}
                    >
                      {request.subject}
                    </Link>
                    {request.confidential && (
                      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                        Конфиденциально
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {labelOf("type", request.typeCode)} · приоритет{" "}
                    {labelOf("priority", request.priorityCode)} ·{" "}
                    {moduleLabel(request.moduleCode)} · {request.authorLabel} ·{" "}
                    {formatMoment(request.createdAt)}
                  </p>

                  {request.restrictedReason === null ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {request.descriptionPreview}
                    </p>
                  ) : (
                    // Причина видимым текстом: пустое место читалось бы как
                    // «не заполнено».
                    <p className="mt-1 text-xs text-muted-foreground">
                      {request.restrictedReason}
                    </p>
                  )}

                  {request.attachments !== null && request.attachments.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Вложения (метаданные):{" "}
                      {request.attachments
                        .map((file) => `${file.fileName} · ${formatSize(file.sizeBytes)}`)
                        .join("; ")}
                    </p>
                  )}

                  {request.technicalInfo !== null && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Техническая информация (по согласию автора):{" "}
                      {request.technicalInfo.appRevision} ·{" "}
                      {request.technicalInfo.viewport} ·{" "}
                      {request.technicalInfo.platform}
                    </p>
                  )}

                  {request.isOwn && request.statusCode === "DRAFT" && (
                    <div className="mt-2">
                      <button
                        type="button"
                        className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                        disabled={submitDraft.isPending}
                        onClick={() =>
                          submitDraft.mutate({ feedbackId: request.feedbackId })
                        }
                      >
                        Отправить в работу
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {submitDraft.error !== null && (
            <p className="mt-2 text-xs text-destructive-ink">
              {submitDraft.error.message}
            </p>
          )}

          {data !== undefined && (
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={data.page <= 1}
                onClick={() => setPage(data.page - 1)}
              >
                Назад
              </button>
              <span>
                Страница {data.page} из {data.pageCount} · найдено {data.totalMatched}
              </span>
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={data.page >= data.pageCount}
                onClick={() => setPage(data.page + 1)}
              >
                Вперёд
              </button>
            </div>
          )}
        </section>

        {data !== undefined && (
          <section className="rounded-xl border border-dashed bg-muted/30 p-4">
            <h2 className="mb-2 text-sm font-semibold">
              Чего этот раздел не делает и почему
            </h2>
            <ul className="flex flex-col gap-2">
              {data.unavailableCapabilities.map((item) => (
                <li key={item.code} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{item.label}</span>{" "}
                  — {item.reason}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}

interface FeedbackFormProps {
  types: readonly { code: FeedbackTypeCode; label: string }[];
  priorities: readonly { code: FeedbackPriorityCode; label: string }[];
  modules: readonly { moduleCode: string; label: string }[];
  relatedRoute: string;
  serverTime: string | null;
  pending: boolean;
  errorMessage: string | null;
  onSubmit: (body: {
    subject: string;
    description: string;
    typeCode: FeedbackTypeCode;
    priorityCode: FeedbackPriorityCode;
    moduleCode: string;
    expectedResult: string | null;
    reproductionSteps: string | null;
    contact: string | null;
    confidential: boolean;
    relatedRoute: string | null;
    attachments: FeedbackAttachmentMeta[];
    includeTechnicalInfo: boolean;
    technicalInfo: {
      appRevision: string;
      viewport: string;
      platform: string;
      capturedAt: string;
    } | null;
    saveAsDraft: boolean;
  }) => void;
}

function FeedbackForm(props: FeedbackFormProps) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [typeCode, setTypeCode] = useState<FeedbackTypeCode>(
    props.types[0]?.code ?? "BUG"
  );
  const [priorityCode, setPriorityCode] = useState<FeedbackPriorityCode>("NORMAL");
  const [moduleCode, setModuleCode] = useState(props.modules[0]?.moduleCode ?? "");
  const [expectedResult, setExpectedResult] = useState("");
  const [reproductionSteps, setReproductionSteps] = useState("");
  const [contact, setContact] = useState("");
  const [confidential, setConfidential] = useState(false);
  const [includeTechnicalInfo, setIncludeTechnicalInfo] = useState(false);
  const [attachments, setAttachments] = useState<FeedbackAttachmentMeta[]>([]);

  function collect(saveAsDraft: boolean): void {
    props.onSubmit({
      subject,
      description,
      typeCode,
      priorityCode,
      moduleCode,
      expectedResult: expectedResult.trim() === "" ? null : expectedResult,
      reproductionSteps: reproductionSteps.trim() === "" ? null : reproductionSteps,
      contact: contact.trim() === "" ? null : contact,
      confidential,
      // §28 «related route»: предмет обращения, не телеметрия — не зависит от
      // согласия на техническую информацию.
      relatedRoute: props.relatedRoute,
      attachments,
      includeTechnicalInfo,
      technicalInfo: includeTechnicalInfo
        ? {
            appRevision: `port-${PORT_VERSION}`,
            viewport: `${window.innerWidth}×${window.innerHeight}`,
            platform: navigator.userAgent.includes("Mobile") ? "mobile" : "desktop",
            // Время — серверное (из последнего ответа реестра), а не new Date().
            capturedAt: props.serverTime ?? "",
          }
        : null,
      saveAsDraft,
    });
  }

  return (
    <section
      role="group"
      aria-label="Форма обращения"
      className="rounded-xl border bg-card p-4"
    >
      <h2 className="mb-3 text-sm font-semibold">Новое обращение</h2>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Тема
          <input
            aria-label="Тема обращения"
            className="rounded-md border bg-background p-2 text-sm font-normal"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Описание
          <textarea
            aria-label="Описание обращения"
            className="min-h-20 rounded-md border bg-background p-2 text-sm font-normal"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Тип обращения
            <select
              aria-label="Тип обращения"
              className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
              value={typeCode}
              onChange={(event) => setTypeCode(event.target.value as FeedbackTypeCode)}
            >
              {props.types.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Приоритет
            <select
              aria-label="Приоритет обращения"
              className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
              value={priorityCode}
              onChange={(event) =>
                setPriorityCode(event.target.value as FeedbackPriorityCode)
              }
            >
              {props.priorities.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Модуль
            <select
              aria-label="Модуль обращения"
              className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
              value={moduleCode}
              onChange={(event) => setModuleCode(event.target.value)}
            >
              {props.modules.map((entry) => (
                <option key={entry.moduleCode} value={entry.moduleCode}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs font-semibold">
          Ожидаемый результат
          <input
            aria-label="Ожидаемый результат"
            className="rounded-md border bg-background p-2 text-sm font-normal"
            value={expectedResult}
            onChange={(event) => setExpectedResult(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Шаги воспроизведения
          <input
            aria-label="Шаги воспроизведения"
            className="rounded-md border bg-background p-2 text-sm font-normal"
            value={reproductionSteps}
            onChange={(event) => setReproductionSteps(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Контакт для ответа
          <input
            aria-label="Контакт для ответа"
            className="rounded-md border bg-background p-2 text-sm font-normal"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold">
          Вложение
          <input
            type="file"
            aria-label="Вложение обращения"
            className="text-xs font-normal"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              // Из файла берутся РОВНО метаданные: содержимое не читается —
              // blob-хранилища нет.
              setAttachments(
                files.map((file) => ({
                  fileName: file.name,
                  sizeBytes: file.size,
                  mimeType: file.type,
                }))
              );
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Сохраняются только имя, размер и тип файла: хранилища файлов в этом
          контуре нет, поэтому содержимое вложения не передаётся и не сохраняется.
        </p>

        <label className="flex items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={confidential}
            onChange={(event) => setConfidential(event.target.checked)}
          />
          Конфиденциально — содержание видят только автор и обладатель отдельного
          права
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={includeTechnicalInfo}
            onChange={(event) => setIncludeTechnicalInfo(event.target.checked)}
          />
          Приложить техническую информацию (сборка, размер окна, платформа)
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            disabled={props.pending || subject.trim() === "" || description.trim() === ""}
            onClick={() => collect(false)}
          >
            Создать обращение
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={props.pending || subject.trim() === "" || description.trim() === ""}
            onClick={() => collect(true)}
          >
            Сохранить без отправки
          </button>
        </div>
        {props.errorMessage !== null && (
          <p className="text-xs text-destructive-ink">{props.errorMessage}</p>
        )}
      </div>
    </section>
  );
}
