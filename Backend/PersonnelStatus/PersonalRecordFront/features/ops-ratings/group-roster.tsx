import type { GroupRatingSnapshot } from "@/entities/operational-rating";

export function GroupRoster({ snapshot }: { snapshot?: GroupRatingSnapshot | null }) {
  if (!snapshot) return null;
  return (
    <section className="my-3 rounded-md border p-3 text-xs" aria-label="Состав оцениваемой группы">
      <p className="mb-2 font-medium">Объект: {snapshot.objectLabel} · {snapshot.postLabel}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {([
          ["Плановый состав", snapshot.plannedMembers],
          ["Фактический состав", snapshot.actualMembers],
        ] as const).map(([label, members]) => (
          <div key={label}>
            <h4 className="mb-1 font-semibold">{label}</h4>
            {members.length === 0 ? <p>Участники не подтверждены.</p> : (
              <ul className="space-y-1">
                {members.map(member => (
                  <li key={member.participantCode}>
                    <span>{member.safeLabel}</span>{member.unitSafeLabel && <span className="text-muted-foreground"> · {member.unitSafeLabel}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-muted-foreground">
        Одна коллективная оценка относится к этому составу. Она учитывается отдельно от индивидуальных оценок участников.
      </p>
    </section>
  );
}
