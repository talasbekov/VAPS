"""Small projection of an event already read with the caller's credentials."""


def assignment_progress(event, *, handed_over=False):
    need = event.get("forceDemandTotal") if event.get("reconForceRequestedAt") else None
    collected = len(event.get("forceRoster", []))
    return {
        "collectionClosed": handed_over or event.get("stage") in {"APPROVAL", "ACKNOWLEDGEMENT", "CONDUCT", "CLOSED"},
        "need": need,
        "collected": collected,
        "remaining": max(0, need - collected) if need is not None else None,
        "departments": [
            {"id": str(row["id"]), "name": row.get("departmentName") or "Департамент",
             "requested": row["need"], "responded": row.get("allocating"),
             "status": row["status"], "overdue": bool(row.get("overdue"))}
            for row in event.get("forceAllocation", []) if row.get("sentAt")
        ],
    }
