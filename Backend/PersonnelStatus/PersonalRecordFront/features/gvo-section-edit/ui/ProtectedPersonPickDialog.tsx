"use client";

// Охраняемое лицо в сводку — из справочника, с возможностью завести новое
// (Plane №951).
//
// Заказчик: «со справочника ОЛ нужно подтягивать ОЛ и здесь же должна быть
// кнопка добавить ОЛ». До этого лицо в сводке было текстом («ФИО»,
// «Должность») без ссылки на каталог — и без фотографии, потому что класть
// её было некуда. Теперь карточка лица несёт ссылку (`personId`): код и снимок
// по ней подставляет сервер, а здесь два пути — выбрать из списка или завести
// новое лицо (имя, категория, позывной, биография, снимок) и сразу поставить
// его в сводку.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateProtectedPerson,
  useProtectedPersons,
  useUploadProtectedPersonPhoto,
} from "@/hooks/use-protected-persons";
import {
  PROTECTED_PERSON_CATEGORIES,
  PROTECTED_PERSON_CATEGORY_LABEL,
  PROTECTED_PERSON_FACT_KEYS,
} from "@/entities/protected-person";
import type { ProtectedPerson, ProtectedPersonCategory } from "@/entities/protected-person";
import { ProtectedPhoto } from "@/shared/ui/protected-photo";

const LABEL_CLASS = "block text-[11.5px] font-bold text-muted-foreground";
const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-input bg-background px-2.5 text-sm " +
  "outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

export function ProtectedPersonPickDialog({
  open,
  takenIds,
  onPick,
  onClose,
}: {
  open: boolean;
  /** Лица, уже стоящие в сводке: второй раз не ставят. */
  takenIds: Set<string>;
  onPick: (person: ProtectedPerson) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"pick" | "create">("pick");
  useEffect(() => {
    if (open) setMode("pick");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {mode === "pick" ? (
          <PickFromCatalog
            takenIds={takenIds}
            onPick={(person) => {
              onPick(person);
              onClose();
            }}
            onCreate={() => setMode("create")}
            onClose={onClose}
          />
        ) : (
          <CreatePerson
            onCreated={(person) => {
              onPick(person);
              onClose();
            }}
            onBack={() => setMode("pick")}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PickFromCatalog({
  takenIds,
  onPick,
  onCreate,
  onClose,
}: {
  takenIds: Set<string>;
  onPick: (person: ProtectedPerson) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const catalog = useProtectedPersons();
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = catalog.data?.results ?? [];
    return needle === ""
      ? all
      : all.filter(
          (person) =>
            person.name.toLowerCase().includes(needle) ||
            person.code.toLowerCase().includes(needle) ||
            person.callsign.toLowerCase().includes(needle)
        );
  }, [catalog.data, search]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Охраняемое лицо из справочника</DialogTitle>
        <DialogDescription>
          Код и снимок лица подставятся из записи справочника; нет нужного — заведите
          новое здесь же.
        </DialogDescription>
      </DialogHeader>
      <div className="relative">
        <Search
          className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          className="pl-8"
          placeholder="Поиск: имя, код, позывной"
          aria-label="Поиск охраняемого лица"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border" data-slot="protected-person-picker">
        {catalog.isPending && (
          <p className="px-3 py-4 text-xs text-muted-foreground">Загрузка справочника…</p>
        )}
        {catalog.isError && (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            Справочник лиц сейчас недоступен.
          </p>
        )}
        {catalog.data && rows.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {search.trim() === "" ? "Справочник пуст." : "По запросу никого не нашлось."}
          </p>
        )}
        <ul>
          {rows.map((person) => {
            const taken = takenIds.has(person.id);
            return (
              <li key={person.id} className="border-b last:border-0">
                <button
                  type="button"
                  disabled={taken}
                  onClick={() => onPick(person)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {person.photoUrl === null ? (
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] text-muted-foreground"
                      aria-hidden="true"
                    >
                      нет фото
                    </span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <ProtectedPhoto
                      url={person.photoUrl}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-md object-cover"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{person.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {[person.code, PROTECTED_PERSON_CATEGORY_LABEL[person.category], person.callsign]
                        .filter((part) => part !== "")
                        .join(" · ")}
                    </span>
                  </span>
                  {taken && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">уже в сводке</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="outline" onClick={onCreate}>
          ＋ Новое лицо в справочник
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Отмена
        </Button>
      </DialogFooter>
    </>
  );
}

function CreatePerson({
  onCreated,
  onBack,
}: {
  onCreated: (person: ProtectedPerson) => void;
  onBack: () => void;
}) {
  const ids = useId();
  const create = useCreateProtectedPerson();
  const upload = useUploadProtectedPersonPhoto();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProtectedPersonCategory>("FOREIGN");
  const [callsign, setCallsign] = useState("");
  const [bio, setBio] = useState("");
  // Данные образца (Plane №952): страна, должность и параметры «ключ =
  // значение» — по одному полю на параметр образца, пустые не уезжают.
  const [country, setCountry] = useState("");
  const [position, setPosition] = useState("");
  const [facts, setFacts] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const busy = create.isPending || upload.isPending;

  async function submit() {
    if (name.trim() === "") {
      setNameError("Обязательное поле.");
      return;
    }
    setFailure(null);
    try {
      let person = await create.mutateAsync({
        name: name.trim(),
        category,
        callsign: callsign.trim(),
        bio: bio.trim(),
        country: country.trim(),
        position: position.trim(),
        facts: PROTECTED_PERSON_FACT_KEYS.map((key) => ({
          key,
          value: (facts[key] ?? "").trim(),
        })).filter((fact) => fact.value !== ""),
      });
      if (file !== null) {
        // Лицо уже заведено — отказ снимка не должен читаться как «лицо не
        // заведено»: об этом говорится отдельной строкой, а лицо ставится в
        // сводку без снимка.
        try {
          person = await upload.mutateAsync({ id: person.id, file });
        } catch {
          setFailure("Лицо заведено, но снимок не загрузился — добавьте его позже.");
          onCreated(person);
          return;
        }
      }
      onCreated(person);
    } catch (error) {
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
      setFailure(message === "" ? "Не удалось завести лицо. Попробуйте ещё раз." : message);
    }
  }

  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Новое охраняемое лицо</DialogTitle>
        <DialogDescription>
          Запись попадёт в справочник «Охраняемые лица» и сразу встанет в сводку.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1">
        <label htmlFor={`${ids}-name`} className={LABEL_CLASS}>
          ФИО
        </label>
        <Input
          id={`${ids}-name`}
          value={name}
          aria-invalid={nameError !== null}
          aria-describedby={nameError === null ? undefined : `${ids}-name-error`}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
        />
        {nameError !== null && (
          <p id={`${ids}-name-error`} className="text-[11px] text-destructive-ink">
            {nameError}
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${ids}-category`} className={LABEL_CLASS}>
            Категория
          </label>
          <select
            id={`${ids}-category`}
            className={SELECT_CLASS}
            value={category}
            onChange={(e) => setCategory(e.target.value as ProtectedPersonCategory)}
          >
            {PROTECTED_PERSON_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {PROTECTED_PERSON_CATEGORY_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${ids}-callsign`} className={LABEL_CLASS}>
            Позывной
          </label>
          <Input id={`${ids}-callsign`} value={callsign} onChange={(e) => setCallsign(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${ids}-position`} className={LABEL_CLASS}>
            Должность
          </label>
          <Input
            id={`${ids}-position`}
            placeholder="Президент Черногории"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${ids}-country`} className={LABEL_CLASS}>
            Страна
          </label>
          <Input
            id={`${ids}-country`}
            placeholder="Черногория"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">Подставится в «Страну» сводки при выборе лица.</p>
        </div>
      </div>
      <fieldset className="space-y-2 rounded-lg border p-3">
        <legend className={`${LABEL_CLASS} px-1`}>Данные образца</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PROTECTED_PERSON_FACT_KEYS.map((key, index) => (
            <div key={key} className="space-y-1">
              <label htmlFor={`${ids}-fact-${index}`} className="block text-[11px] text-muted-foreground">
                {key}
              </label>
              <Input
                id={`${ids}-fact-${index}`}
                className="h-9 text-[12.5px]"
                value={facts[key] ?? ""}
                onChange={(e) => setFacts((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1">
        <label htmlFor={`${ids}-bio`} className={LABEL_CLASS}>
          Биография
        </label>
        <Textarea id={`${ids}-bio`} rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${ids}-photo`} className={LABEL_CLASS}>
          Фото
        </label>
        <input
          id={`${ids}-photo`}
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="block w-full text-xs file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-xs"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p className="text-[11px] text-muted-foreground">JPEG, PNG или WebP, до 5 МБ.</p>
      </div>
      {failure !== null && (
        <p className="text-sm text-destructive-ink" role="alert">
          {failure}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onBack}>
          Назад к списку
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Сохранение…" : "Завести и поставить в сводку"}
        </Button>
      </DialogFooter>
    </form>
  );
}
