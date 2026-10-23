"use client";

import { Suspense } from "react";
import { AssistantWorkspace } from "@/features/om-assistant/workspace";

export default function AssistantPage() {
  return <Suspense fallback={<p className="p-6" role="status">Загружаем помощника по ОМ…</p>}><AssistantWorkspace /></Suspense>;
}
