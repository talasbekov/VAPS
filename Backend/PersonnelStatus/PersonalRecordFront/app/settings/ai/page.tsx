"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { assertOpsReadAuthority, hasOpsReadAuthority, useOpsProtectedRead, useOpsReadAccess, type OpsReadAccess } from "@/hooks/use-ops-protected-read";
import { opsApiClient } from "@/lib/ops-api";
import { OpsApiError } from "@/lib/ops-errors";

const SETTINGS_PATH = "/api/ops/assistant-settings/";
type Provider = "disabled" | "openai" | "ollama";
interface Settings {
  provider: Provider;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  revision: string;
  keyError?: string;
}
type Draft = Pick<Settings, "provider" | "baseUrl" | "model">;
type Notice = { ok: boolean; message: string };

export default function AiSettingsPage() {
  const { hasGlobalPermission, isLoading, error } = useOpsPermissions();
  const access = useOpsReadAccess("settings.manage");
  if (isLoading) return <DashboardLayout><p>Проверка прав доступа…</p></DashboardLayout>;
  if (error || !access.allowed || !hasGlobalPermission("settings.manage")) return <OpsAccessDenied what="подключения ИИ" />;
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-2xl space-y-4">
        <Button asChild variant="ghost" size="sm"><Link href="/settings/">← Настройки</Link></Button>
        <PageHeader eyebrow="Администрирование" title="Подключение ИИ"
          description="Настройте модель для ИИ-помощника. Проверка не меняет параметры подключения; результат проверки сохраняется в состоянии системы." />
        <SettingsLoader key={access.scope} access={access} />
      </div>
    </DashboardLayout>
  );
}

function SettingsLoader({ access }: { access: OpsReadAccess }) {
  const query = useOpsProtectedRead<Settings>(["ops-assistant-settings", "connection"], [], access,
    () => opsApiClient.get<Settings>(SETTINGS_PATH), { refetchOnWindowFocus: false, gcTime: 0 });
  const [generation, setGeneration] = useState(0);
  if (query.isLoading) return <p role="status">Загрузка подключения ИИ…</p>;
  if (query.isError || !query.data) return (
    <Card><CardContent className="space-y-3 pt-6">
      <p role="alert">Не удалось загрузить настройки подключения ИИ.</p>
      <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Повторить загрузку</Button>
    </CardContent></Card>
  );
  return <SettingsForm key={generation} initial={query.data} access={access} source={query.readKey} canAct={query.canAct} onReload={async () => {
    const result = await query.refetch();
    if (result.isSuccess) setGeneration(value => value + 1);
  }} />;
}

function address(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || /[\x00-\x20\\]/.test(value)) return null;
    return url;
  } catch { return null; }
}

function SettingsForm({ initial, access, source, canAct, onReload }: {
  initial: Settings; access: OpsReadAccess; source: QueryKey; canAct: boolean; onReload: () => Promise<void>;
}) {
  const client = useQueryClient();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<Draft>({ provider: initial.provider, baseUrl: initial.baseUrl, model: initial.model });
  // A secret is held only in this mounted editor. It never enters query caches or browser storage.
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [pending, setPending] = useState<"check" | "save" | "reload" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [conflict, setConflict] = useState(false);
  const dirty = draft.provider !== saved.provider || draft.baseUrl !== saved.baseUrl || draft.model !== saved.model || apiKey.trim() !== "" || clearKey;
  const enabled = draft.provider !== "disabled";
  const newAddress = address(draft.baseUrl.trim());
  const oldAddress = address(saved.baseUrl);
  const originChanged = saved.hasKey && newAddress !== null && newAddress.origin !== oldAddress?.origin;
  const keyError = !apiKey.trim() && !clearKey ? saved.keyError ||
    (originChanged ? "Адрес сервера изменён: замените или удалите сохранённый ключ перед проверкой и сохранением." : null) : null;
  const invalid = enabled && (!newAddress || !draft.model.trim());

  function edited() { setNotice(null); setConflict(false); }
  function change<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft(current => ({ ...current, [field]: value })); edited();
  }
  async function submit(action: "check" | "save") {
    if (!canAct || pending || invalid || keyError || (action === "check" && !enabled)) return;
    setPending(action); setNotice(null); setConflict(false);
    const body = {
      ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), revision: saved.revision,
      ...(clearKey ? { clearKey: true } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    };
    try {
      assertOpsReadAuthority(client, access, "ops-assistant-settings", source);
      if (action === "check") {
        const result = await opsApiClient.post<Notice>(`${SETTINGS_PATH}check/`, body);
        if (!hasOpsReadAuthority(client, access, "ops-assistant-settings", source)) return;
        setNotice(result);
      } else {
        const result = await opsApiClient.put<Settings>(SETTINGS_PATH, body);
        if (!hasOpsReadAuthority(client, access, "ops-assistant-settings", source)) return;
        setSaved(result);
        setDraft({ provider: result.provider, baseUrl: result.baseUrl, model: result.model });
        setApiKey(""); setClearKey(false);
        setNotice({ ok: true, message: "Настройки сохранены." });
      }
    } catch (error) {
      setConflict(error instanceof OpsApiError && error.status === 409);
      const details = error instanceof OpsApiError ? Object.values(error.details)
        .flatMap(value => typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []) : [];
      setNotice({ ok: false, message: details.length ? details.join(" ") : error instanceof Error ? error.message : "Не удалось выполнить запрос. Повторите попытку." });
    } finally { setPending(null); }
  }

  return (
    <Card><CardContent className="pt-6">
      <form className="space-y-5" onSubmit={event => { event.preventDefault(); void submit("save"); }}>
        <fieldset disabled={!canAct || pending !== null} className="min-w-0 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="ai-provider">Провайдер</Label>
            <select id="ai-provider" value={draft.provider} onChange={event => change("provider", event.target.value as Provider)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="disabled">ИИ отключён</option>
              <option value="openai">OpenAI-совместимый API</option>
              <option value="ollama">Ollama</option>
            </select>
            {!enabled && <p className="text-sm text-muted-foreground">ИИ отключён. Выберите провайдера, чтобы настроить соединение.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-address">Адрес API</Label>
            <Input id="ai-address" type="url" disabled={!enabled} value={draft.baseUrl} placeholder="http://10.15.3.100:8002"
              autoComplete="off" spellCheck={false} onChange={event => change("baseUrl", event.target.value)} aria-describedby="ai-address-help" />
            <p id="ai-address-help" className="text-xs text-muted-foreground">Адрес сервера с http:// или https://. Без ключа, логина и параметров запроса.</p>
            {enabled && draft.baseUrl.trim() && !newAddress && <p role="alert" className="text-sm text-destructive-ink">Введите корректный адрес API.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-model">Модель</Label>
            <Input id="ai-model" disabled={!enabled} value={draft.model} placeholder="gemma-4-31b-it" autoComplete="off"
              onChange={event => change("model", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-key">Ключ API</Label>
            <Input id="ai-key" type="password" value={apiKey} disabled={clearKey} autoComplete="new-password" spellCheck={false}
              placeholder={saved.keyError ? "Укажите новый ключ" : saved.hasKey ? "•••••••• (сохранён)" : "Если сервер требует ключ"}
              aria-describedby="ai-key-help" onChange={event => { setApiKey(event.target.value); edited(); }} />
            <div id="ai-key-help" className="text-xs text-muted-foreground">
              {saved.keyError ? <p>Сохранённый ключ недоступен. Замените его или отметьте удаление.</p>
                : saved.hasKey ? <><p>Ключ сохранён на сервере.</p><p>Оставьте поле пустым, чтобы сохранить прежний ключ.</p></>
                : <p>Ключ не сохранён. Можно оставить поле пустым, если сервер не требует ключ.</p>}
            </div>
            {saved.hasKey && <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={clearKey} className="mt-1" onChange={event => {
                setClearKey(event.target.checked); setApiKey(""); edited();
              }} />
              Удалить сохранённый ключ
            </label>}
          </div>
        </fieldset>
        {keyError && <p role="alert" className="text-sm text-destructive-ink">{keyError}</p>}
        {notice && <p role={notice.ok ? "status" : "alert"} className={`text-sm break-words ${notice.ok ? "text-primary-ink" : "text-destructive-ink"}`}>{notice.message}</p>}
        {conflict && <Button type="button" variant="outline" className="h-auto whitespace-normal" disabled={!canAct || pending !== null}
          onClick={() => { setPending("reload"); void onReload().finally(() => setPending(null)); }}>
          Загрузить актуальные настройки и сбросить изменения
        </Button>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={!canAct || pending !== null || !enabled || invalid || Boolean(keyError)} onClick={() => void submit("check")}>
            {pending === "check" ? "Проверка…" : "Проверить соединение"}
          </Button>
          <Button type="submit" disabled={!canAct || pending !== null || !dirty || invalid || Boolean(keyError)}>
            {pending === "save" ? "Сохранение…" : "Сохранить"}
          </Button>
        </div>
        {dirty && <p className="text-xs text-muted-foreground">Есть несохранённые изменения.</p>}
      </form>
    </CardContent></Card>
  );
}
