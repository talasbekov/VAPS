"use client";

import { createContext } from "react";

// Only the protected segment supplies this promise. Outside its Suspense
// boundary, failed permission checks continue to return no authority.
export const OpsPermissionSuspensionContext = createContext<Promise<void> | null>(null);

// Body-level portals escape Suspense's hidden host tree. Keep protected
// popups under the same primary host so they are hidden with their editor.
export const OpsProtectedPortalContext = createContext<HTMLElement | null>(null);

// Event callbacks in a suspended tree retain their committed closures. This
// stable reader lets portal primitives reject dismissal during an outage.
export const OpsProtectedInteractionContext = createContext<() => boolean>(() => false);
