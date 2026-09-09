/**
 * У каждой страницы раздела ОМ есть СВОЁ решение о врезке «не подключено», и в
 * живом режиме врезки нет ни на одной — сверка без браузера и стенда (Plane
 * №948).
 *
 * ЧТО БЫЛО. В `lib/api-gaps.ts` жила общая запись `/security-ops → «на бэке
 * нет /api/ops/*»`, написанная до появления бэка раздела. Она работала
 * ПОДСТИЛКОЙ ПО УМОЛЧАНИЮ: экран, которому не выписали правило в
 * `findApiGap`, получал жёлтую врезку над живыми данными. Так над сводкой ГВО
 * висело «не подключено», и заказчик спросил, не мок ли это (07.09.2026).
 * Никакая проба этого не ловила: реестр врезок проверялся только глазами.
 *
 * ЧТО СТАЛО. Общей записи нет; каждая страница `app/security-ops/**` обязана
 * попадать под явный префикс `SECURITY_OPS_RULED_PREFIXES`, а в режиме по
 * умолчанию (все домены живые) `findApiGap` обязан вернуть null для каждой.
 *
 * `SMOKE_LIVE` не требуется и не проверяется — намеренно (см.
 * route-map-coverage.spec.ts: скип читается как зелень).
 *
 * КРАСНАЯ НА МУТАЦИИ: убери префикс из `SECURITY_OPS_RULED_PREFIXES` —
 * первая проба назовёт потерянную страницу; верни общую запись
 * `/security-ops` в `GAPS` — третья проба назовёт её ключ. (Вторая проба на
 * возврат подстилки НЕ краснеет: каждая объявленная страница отвечает из
 * if-цепочки `findApiGap` раньше, чем дело дойдёт до `GAPS`, — это нашло
 * ревью №825 08.09.2026, и обещание из шапки было пустым.)
 */
import { expect, test } from "@playwright/test";

import { API_GAPS, findApiGap, hasApiGapRule } from "../lib/api-gaps";
import { declaredPortalRoutes } from "./portal-routes";

const securityOpsPages = () =>
  declaredPortalRoutes().filter((route) => route.startsWith("/security-ops"));

test.describe("врезка «не подключено» в разделе ОМ", () => {
  test.beforeEach(() => {
    // Режим по умолчанию стенда: ни один домен не переведён на мок.
    delete process.env.NEXT_PUBLIC_OPS_MOCK_DOMAINS;
    delete process.env.NEXT_PUBLIC_OPS_LIVE_DOMAINS;
  });

  test("в реестре дыр нет общей записи, накрывающей раздел ОМ", () => {
    // Подстилка `/security-ops` (и любой её префикс-родитель) — та самая
    // запись, что вешала «не подключено» над живой сводкой ГВО (№948).
    const covering = Object.keys(API_GAPS).filter((key) => "/security-ops".startsWith(key));
    expect(covering, "общая запись реестра снова накрывает /security-ops").toEqual([]);
  });

  test("у каждой страницы раздела есть своё правило", () => {
    const pages = securityOpsPages();
    expect(pages.length, "страниц раздела не найдено — проба вакуумна").toBeGreaterThan(10);
    const unruled = pages.filter((route) => !hasApiGapRule(route.replace(/:x/g, "1")));
    expect(unruled, "страницы app/security-ops без решения о врезке").toEqual([]);
  });

  test("в живом режиме врезки нет ни на одной странице раздела", () => {
    const withNotice = securityOpsPages()
      .map((route) => route.replace(/:x/g, "1"))
      .filter((route) => findApiGap(route) !== null);
    expect(withNotice, "страницы, над которыми в живом режиме стоит врезка").toEqual([]);
  });

  test("врезка возвращается, когда домен экрана переведён на мок", () => {
    process.env.NEXT_PUBLIC_OPS_MOCK_DOMAINS = "gvo";
    expect(findApiGap("/security-ops/visits/1")?.subject).toContain("ГВО");
    expect(findApiGap("/security-ops/persons")).toBeNull();
  });
});
