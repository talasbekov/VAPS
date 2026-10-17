"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { PassportVersion } from "@/entities/security-object";

export function PassportVersionSnapshot({ version }: { version: PassportVersion }) {
  return <>
    <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
      Опубликованная версия неизменяема: это снимок паспорта на момент публикации, а не действующая редакция.
    </p>
    {version.note !== "" && <Card className="mb-4"><CardContent className="p-4">
      <h2 className="mb-1 text-sm font-semibold">Примечание к публикации</h2>
      <p className="text-sm text-muted-foreground">{version.note}</p>
    </CardContent></Card>}
    <div className="flex flex-col gap-4">
      {version.sectors.map(sector => <Card key={sector.id}><CardContent className="p-4">
        <h2 className="mb-2 text-sm font-semibold">{sector.name}</h2>
        {sector.posts.length === 0 ? <p className="text-xs text-muted-foreground">Постов в секторе нет.</p> :
          <ul className="flex flex-col gap-1.5">{sector.posts.map(post => <li key={post.id} className="rounded-md border p-2.5 text-xs">
            <span className="font-semibold">{post.name}</span>{" "}
            <span className="text-muted-foreground">{post.task}{post.requirements !== "" ? ` · ${post.requirements}` : ""}</span>
          </li>)}</ul>}
      </CardContent></Card>)}
    </div>
  </>;
}
