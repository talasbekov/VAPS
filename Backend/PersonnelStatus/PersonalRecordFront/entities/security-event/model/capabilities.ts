type VisitObjectCapability = {
  canManageVisitObjects?: boolean;
  stage: string;
};

/**
 * Сервер знает ролевые назначения внутри конкретного ОМ, поэтому его
 * capability главнее глобального кода права клиента (Plane №981).
 * Fallback оставлен только для ответа старой версии API во время выкладки.
 */
export function mayManageVisitObjects(
  event: VisitObjectCapability,
  hasEventManage: boolean,
): boolean {
  return (
    event.stage !== "CLOSED" &&
    (event.canManageVisitObjects ?? hasEventManage)
  );
}

type ReconCapability = {
  canManageRecon?: boolean;
  stage: string;
};

/** Рекогносцировка не имеет клиентского fallback на `event.manage` (№982). */
export function mayManageRecon(visit: ReconCapability | null): boolean {
  return visit?.stage === "RECON" && visit.canManageRecon === true;
}
