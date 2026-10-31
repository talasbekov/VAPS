"use client";

import { createContext, useContext } from "react";

/** React context follows portals; DOM inheritance alone does not. Navbar stays outside. */
export const ContentUiScope = createContext(false);

export function useContentUiClassName() {
  return useContext(ContentUiScope) ? "sj-content-ui" : undefined;
}
