'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { project } from '@/features/offline-map/model/geometry';
import type { AstanaMapAsset } from '@/features/offline-map/model/asset';
import type { BackgroundScene } from '../model/scenes';

const fills: Record<string, string> = { green: '#d5e3cb', water: '#add2dc', building: '#d2d9d0' };
const widths: Record<string, number> = { trunk: 4, primary: 3.2, secondary: 2.4, road: 1.4, path: .7, rail: .8, river: 2 };
const order = ['green', 'water', 'building', 'rail', 'path', 'road', 'secondary', 'primary', 'trunk', 'river'];

/** Passive raster of the existing local geometry. No gestures, tiles or writes. */
function paintMap(ctx: CanvasRenderingContext2D, asset: AstanaMapAsset, scene: BackgroundScene, width: number, height: number) {
  const zoom = scene.kind === 'object' ? 15 : 13;
  const scale = 2 ** (zoom - 16), center = project(scene.center);
  const left = center[0] - width / 2 / scale, top = center[1] - height / 2 / scale;
  const right = left + width / scale, bottom = top + height / scale;
  ctx.fillStyle = '#e8eee6'; ctx.fillRect(0, 0, width, height);
  const groups = new Map<string, typeof asset.geometry.features>();
  for (const feature of asset.geometry.features) {
    if (zoom < 14 && (feature.kind === 'building' || feature.kind === 'path')) continue;
    const b = feature.bounds;
    if (b[2] < left || b[0] > right || b[3] < top || b[1] > bottom) continue;
    const group = groups.get(feature.kind) ?? []; group.push(feature); groups.set(feature.kind, group);
  }
  const coords = asset.geometry.coordinates;
  for (const kind of order) {
    ctx.fillStyle = fills[kind] ?? '#fff';
    ctx.strokeStyle = kind === 'river' ? '#add2dc' : kind === 'rail' ? '#bac7bd' : kind === 'path' ? '#dce3d7' : '#fff';
    ctx.lineWidth = (widths[kind] ?? 1) * Math.max(.7, 2 ** ((zoom - 14) / 3));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const feature of groups.get(kind) ?? []) {
      ctx.beginPath();
      feature.nodes.forEach((node, index) => {
        const x = (coords[node * 2] - left) * scale, y = (coords[node * 2 + 1] - top) * scale;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      if (fills[kind]) { ctx.closePath(); ctx.fill(); } else ctx.stroke();
    }
  }
  if (scene.kind === 'object') {
    ctx.beginPath(); ctx.arc(width / 2, height / 2, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#f7ce46'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
  }
}

export default function MapBackdrop({ asset, scene, className, onReady, onError }: {
  asset: AstanaMapAsset; scene: BackgroundScene; className: string; onReady(): void; onError(): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(entries => {
      clearTimeout(timer);
      const { width, height } = entries[0].contentRect;
      timer = setTimeout(() => setSize({ width: Math.round(width), height: Math.round(height) }), 150);
    });
    observer.observe(element);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, []);
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || !size.width || !size.height) return;
    try {
      // A soft background needs one backing pixel per CSS pixel, not a large GPU map.
      element.width = size.width; element.height = size.height;
      const context = element.getContext('2d', { alpha: false, willReadFrequently: true });
      if (!context) throw new Error('Canvas unavailable');
      paintMap(context, asset, scene, size.width, size.height);
      element.dataset.painted = 'true'; onReady();
    } catch { onError(); }
  }, [asset, scene.center.latitude, scene.center.longitude, scene.kind, size.width, size.height, onReady, onError]);
  return <canvas ref={canvas} className={className} aria-hidden="true" />;
}
