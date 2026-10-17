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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

export function inspectShotPaths(projectRoot = root) {
  // The offline export uses tests/; full checkouts may also contain e2e/.
  const files = ["e2e", "tests"]
    .map((dir) => join(projectRoot, dir))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => walk(dir));
  if (files.length === 0) throw new Error("Нет файлов проверок в tests/ или e2e/.");
  const offenders = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // Check screenshot calls, not unrelated properties named path.
    for (const call of text.matchAll(/\.screenshot\(\s*\{([\s\S]{0,400}?)\}\s*\)/g)) {
      const literal = call[1].match(/\bpath:\s*(['"])([^'"]+)\1/);
      if (literal === null) continue;
      const value = literal[2];
      if (ALLOWED_PREFIX.test(value)) continue;
      offenders.push({
        file: relative(projectRoot, file),
        line: text.slice(0, call.index).split("\n").length,
        value,
      });
    }
  }
  return { files, offenders };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { files, offenders } = inspectShotPaths();
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
      process.exitCode = 1;
    } else {
      console.log(`[check-shot-paths] проверено файлов: ${files.length}; снимков мимо закрытых каталогов нет.`);
    }
  } catch (error) {
    console.error(`[check-shot-paths] ${error.message}`);
    process.exitCode = 1;
  }
}
