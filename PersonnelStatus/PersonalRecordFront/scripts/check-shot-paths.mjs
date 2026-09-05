/**
 * Сторож путей снимков экрана в пробах (Plane №747).
 *
 * ЗАЧЕМ. `page.screenshot({ path: '414-over-need-dialog.png' })` пишет файл
 * относительно рабочего каталога, то есть В КОРЕНЬ фронта. `.gitignore`
 * закрывает каталоги `smoke-results…`, `test-results` и `.shot-tmp`, но не
 * корень, и каждый прогон смоука оставлял неотслеживаемый PNG в репозитории —
 * тот мусор, из-за которого в проекте запрещён `git add -A`. К моменту
 * находки в корне лежало семь таких файлов от разных задач.
 *
 * ПОЧЕМУ СТОРОЖ, А НЕ ОДНА ПРАВКА. Правка чинит один вызов; следующая проба
 * напишет так же, потому что голый путь короче и работает. Дефект возвращается
 * молча: смоук зелёный, файл появляется. Сторож встроен в `npm run gate:front`
 * рядом с `check-rewrites` и падает кодом 1 — той же ценой, что опечатка в
 * типах.
 *
 * ЧТО РАЗРЕШЕНО. Ровно три адреса, и все три уже приняты пробами:
 *   - `smoke-results/...` — артефакт прогона, закрыт `.gitignore`;
 *   - `path.join(SHOTS, ...)` и прочие вычисляемые пути — снимок аудита,
 *     который кладётся в `docs/` осознанно и коммитится;
 *   - `process.env.<ЧТО-ТО>` — снимок в каталог сессии, вне репозитория.
 * Запрещён ровно один случай: СТРОКОВЫЙ ЛИТЕРАЛ без разрешённого каталога
 * впереди. Вычисляемое выражение сторож не разбирает и не пытается — он ловит
 * не «плохое место», а «путь, написанный не задумываясь».
 *
 * 🔴 ИСКАТЬ НАДО ВЫЗОВ, А НЕ СЛОВО `path:`. Первая редакция брала любую строку
 * с `path:` и обвинила 30 мест, где это поле значит совсем другое: маршруты
 * страниц в `prototype-skin.spec.ts` (`path: '/dashboard/'`) и переходы
 * статусов в `probe-statuses.ts` (`path: 'cancel'`). Сторож, который кричит на
 * здоровый код, снимают через неделю. Поэтому разбирается тело вызова
 * `.screenshot({ … })`, а не отдельная строка файла.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const E2E = join(root, "e2e");

/** Каталоги, куда снимок класть можно: закрыты `.gitignore` или ведут в `docs/`. */
const ALLOWED_PREFIX = /^(smoke-results|test-results|playwright-report|\.shot-tmp)\//;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const offenders = [];
for (const file of walk(E2E)) {
  const text = readFileSync(file, "utf8");
  // Тело вызова `.screenshot({ … })`: и однострочного, и разложенного на
  // несколько строк. Внутри ищется ТОЛЬКО строковый литерал — вычисляемое
  // выражение под эту форму не подходит и потому не проверяется.
  for (const call of text.matchAll(/\.screenshot\(\s*\{([\s\S]{0,400}?)\}\s*\)/g)) {
    const literal = call[1].match(/\bpath:\s*(['"])([^'"]+)\1/);
    if (literal === null) continue;
    const value = literal[2];
    if (ALLOWED_PREFIX.test(value)) continue;
    offenders.push({
      file: file.slice(root.length + 1),
      line: text.slice(0, call.index).split("\n").length,
      value,
    });
  }
}

if (offenders.length > 0) {
  console.error(
    "\n🔴 Снимок экрана пишется мимо закрытых `.gitignore` каталогов —\n" +
      "   каждый прогон оставит неотслеживаемый файл в репозитории:\n" +
      offenders
        .map((row) => `   ${row.file}:${row.line}   path: '${row.value}'`)
        .join("\n") +
      "\n\n   Класть снимки в `smoke-results/` (артефакт прогона) либо в\n" +
      "   вычисляемый путь (`path.join(SHOTS, …)` — снимок аудита в `docs/`).\n"
  );
  process.exit(1);
}
console.log("[check-shot-paths] снимков мимо закрытых каталогов нет.");
