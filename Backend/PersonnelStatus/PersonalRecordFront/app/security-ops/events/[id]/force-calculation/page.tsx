"use client";

import { useParams } from 'next/navigation';
import { ForceCalculationWorkspace } from '@/features/force-calculation';

export default function ForceCalculationPage() {
  const params = useParams<{ id: string }>();
  return <ForceCalculationWorkspace key={params.id} eventId={params.id} />;
}
