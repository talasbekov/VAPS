"use client";

// Черновик поля ввода + отложенная фиксация значения.
//
// Зачем. Поисковые поля раздела писали значение сразу в URL и в queryKey, то
// есть каждое нажатие клавиши давало router.replace и сетевой запрос: слово из
// восьми букв — восемь запросов, из которых нужен последний. Дебаунса во
// фронте не было вовсе (аудит 17.08.2026, §Производительность, 5 экранов).
//
// Почему черновик отдельным состоянием. Само поле должно отвечать на нажатие
// мгновенно — задерживается только ФИКСАЦИЯ (URL и запрос). Если задержать
// само значение input, поле начинает «отставать» от клавиатуры и терять буквы
// при быстром вводе.
//
// Синхронизация в обратную сторону. Внешнее значение может измениться не из
// этого поля: кнопка «назад», сброс фильтров, ссылка с параметром. Такое
// изменение подхватывается в черновик, а НЕ фиксируется обратно — иначе два
// эффекта начали бы толкать друг друга по кругу.
import { useEffect, useRef, useState } from "react";

export function useDebouncedCommit(
  external: string,
  commit: (value: string) => void,
  delayMs = 350
): [string, (value: string) => void] {
  const [draft, setDraft] = useState(external);
  // Последнее значение, о котором фиксация уже знает: граница между «человек
  // ещё печатает» и «это пришло снаружи».
  const settled = useRef(external);
  // Колбэк держим в ref: вызывающие передают стрелку прямо в JSX, и в
  // зависимостях эффекта она пересоздавала бы таймер на каждом рендере —
  // фиксация не наступала бы вовсе, пока родитель перерисовывается.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    if (external === settled.current) return;
    settled.current = external;
    setDraft(external);
  }, [external]);

  useEffect(() => {
    if (draft === settled.current) return;
    const timer = setTimeout(() => {
      settled.current = draft;
      commitRef.current(draft);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [draft, delayMs]);

  return [draft, setDraft];
}
