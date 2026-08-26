/**
 * Сторож перезаписей API (Plane №174).
 *
 * ЗАЧЕМ. В прод-режиме браузер ходит в бэкенд ОТНОСИТЕЛЬНЫМИ путями, и каждый
 * префикс `/api/...` обязан быть перечислен в `rewrites()` из
 * `next.config.js`. В dev этого не требуется вовсе: там клиент бьёт по
 * абсолютному `BACKEND_URL` и перезаписей не касается. Поэтому пропущенный
 * префикс не проявляется НИ РАЗУ, пока код не окажется на боевом сервере, —
 * так `/api/core/` (звания, должности, подразделения) молча отвечал 404.
 *
 * ПОЧЕМУ СКРИПТ, А НЕ ПРОБА. Запускателя модульных тестов у фронта нет, а
 * ждать e2e по прод-стенду ради проверки, которая читается из двух файлов,
 * дорого. Скрипт встроен в `npm run gate:front` и падает кодом 1.
 *
 * ЧТО СЧИТАЕТСЯ ВЫЗОВОМ. Строковый литерал вида `"/api/<префикс>/"` в коде
 * клиента, ВНЕ КОММЕНТАРИЕВ. Комментарии выкидываются не для чистоты: в этом
 * проекте принято ссылаться в докстроках на адреса схемы («снят с
 * `/api/schema/`»), и без вычистки сторож обвинял бы файл за упоминание.
 *
 * `/api/auth/` исключён намеренно: это маршруты самого NextAuth, живущие в
 * приложении, а не на бэкенде.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const OWN_PREFIXES = new Set(["auth"]);
const SEARCH_DIRS = ["app", "components", "entities", "features", "hooks", "lib", "widgets"];
const CODE = /\.(ts|tsx)$/;

/**
 * Выкинуть СТРОКИ-КОММЕНТАРИИ: те, что начинаются с `//` или с `*` (тело
 * докстроки). Этого достаточно — упоминания адресов в этом проекте живут
 * именно в докстроках.
 *
 * 🔴 Блочные комментарии вырезать регуляркой НЕЛЬЗЯ, и это проверено на себе:
 * `/\*[\s\S]*?\*\//` находит `/*` внутри строкового литерала или шаблона
 * маршрута и съедает всё до следующего `*​/` — вместе с настоящим кодом. Так
 * первая редакция сторожа проглотила три вызова `/api/core/` в `lib/api.ts` и
 * отчиталась «все покрыты» ровно про тот дефект, ради которого писалась.
 */
function stripComments(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (CODE.test(name)) out.push(path);
  }
  return out;
}

const called = new Map();
for (const dir of SEARCH_DIRS) {
  for (const file of walk(join(root, dir))) {
    const text = stripComments(readFileSync(file, "utf8"));
    for (const match of text.matchAll(/["'`]\/api\/([a-z0-9_-]+)\//g)) {
      const prefix = match[1];
      if (OWN_PREFIXES.has(prefix)) continue;
      if (!called.has(prefix)) called.set(prefix, file.slice(root.length + 1));
    }
  }
}

const config = require(join(root, "next.config.js"));
const rewrites = await config.rewrites();
const covered = new Set(
  rewrites.map((rule) => {
    const parts = rule.source.split("/").filter(Boolean);
    return parts[1];
  })
);

const missing = [...called].filter(([prefix]) => !covered.has(prefix));
if (missing.length > 0) {
  console.error(
    "\n🔴 Префиксы API без перезаписи в next.config.js — в прод-режиме они\n" +
      "   отвечают 404, а в dev это не видно вовсе:\n" +
      missing.map(([p, file]) => `   /api/${p}/   зовётся из ${file}`).join("\n") +
      "\n"
  );
  process.exit(1);
}
console.log(`[check-rewrites] префиксов у клиента: ${called.size}, все покрыты перезаписями.`);
