"use client";

import { useEffect, useState } from "react";
import { loadAstanaMapAsset, peekAstanaMapAsset } from "@/features/offline-map/model/asset";
import { readMapBounds } from "./location";

/** Only the public local asset is shared; no object data enters its cache. */
export function useObjectMapAsset() {
  const [bounds, setBounds] = useState(() => readMapBounds(peekAstanaMapAsset()?.manifest.bounds));
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    loadAstanaMapAsset().then(asset => {
      const next = readMapBounds(asset.manifest.bounds);
      if (!next) throw new Error("Invalid map bounds");
      if (active) setBounds(next);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [attempt]);
  return { bounds, error, isLoading: bounds === null && !error, retry: () => setAttempt(value => value + 1) };
}
