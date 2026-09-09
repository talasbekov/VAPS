"use client";

import { useEffect, useState } from "react";

import { getAccessToken } from "@/lib/access-token";
import { mediaSrc } from "@/shared/lib/media";

type ProtectedPhotoProps = {
  url: string | null | undefined;
  alt: string;
  className?: string;
  "data-slot"?: string;
};

/** Render a protected image only after fetching it with the current JWT. */
export function ProtectedPhoto({
  url,
  alt,
  className,
  "data-slot": dataSlot,
}: ProtectedPhotoProps) {
  const resolved = mediaSrc(url);
  const isProtected = Boolean(url?.startsWith("/api/ops/protected-persons/"));
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;

    if (!isProtected || resolved === null) {
      setBlobUrl(null);
      return () => {
        disposed = true;
      };
    }

    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      // Same-origin keeps the JWT in the browser request and lets the Next
      // rewrite select the active backend in both dev and production.
      const response = await fetch(url ?? "", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok || disposed) return;
      const blob = await response.blob();
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setBlobUrl(objectUrl);
    })().catch(() => {
      // The surrounding card already has a textual fallback for a missing
      // image; an expired/denied read must not become a broken-image icon.
    });

    return () => {
      disposed = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [isProtected, resolved, url]);

  if (isProtected) {
    if (blobUrl === null) return null;
    return <img src={blobUrl} alt={alt} className={className} data-slot={dataSlot} />;
  }
  if (resolved === null) return null;
  return <img src={resolved} alt={alt} className={className} data-slot={dataSlot} />;
}
