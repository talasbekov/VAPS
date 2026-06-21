"use client";

import { Profiler } from "react";

interface PerformanceProfilerProps {
  children: React.ReactNode;
  id: string;
}

export function PerformanceProfiler({
  children,
  id,
}: PerformanceProfilerProps) {
  const onRender = (
    id: string,
    phase: string,
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
  ) => {
    if (process.env.NODE_ENV === "development") {
      console.log(`Component ${id}:`, {
        phase,
        actualDuration: `${actualDuration.toFixed(2)}ms`,
        baseDuration: `${baseDuration.toFixed(2)}ms`,
        startTime,
        commitTime,
      });
    }
  };

  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  );
}









