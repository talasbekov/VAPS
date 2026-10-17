export type MapView = { center: [number, number]; zoom: number };

/** Keep the world point under the pointer stationary when the scale changes. */
export function zoomMapAt(view: MapView, delta: number, offset: [number, number] = [0, 0]): MapView {
  const zoom = Math.max(11, Math.min(18, view.zoom + delta));
  if (zoom === view.zoom) return view;
  const scale = 2 ** (view.zoom - 16), nextScale = 2 ** (zoom - 16);
  return {
    zoom,
    center: [
      view.center[0] + offset[0] / scale - offset[0] / nextScale,
      view.center[1] + offset[1] / scale - offset[1] / nextScale,
    ],
  };
}
