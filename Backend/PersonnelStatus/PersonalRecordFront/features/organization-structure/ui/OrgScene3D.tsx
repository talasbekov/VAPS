'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Division, StaffUnit, StaffUnitStatistics } from '@/lib/api';
import { useOpsPermissions } from '@/hooks/use-ops-permissions';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Maximize2, Minus, Plus, RotateCcw, Search, Network } from 'lucide-react';
import { buildSceneLayout, selectSceneTree, type SceneUnit } from '../scene3d-layout';
import { labelTextureWidth, type LabelTextureWidth } from '../scene3d-label-resolution';
import styles from './org-scene3d.module.css';
import { DivisionEmployees } from './DivisionEmployees';

interface SceneActions {
  rotate: (horizontal: number, vertical: number) => void;
  zoom: (closer: boolean) => void;
  reset: () => void;
  fit: () => void;
  pan: (direction: number) => void;
  select: (id: number | null) => void;
  focus: (id: number) => void;
}
const kindLabels: Record<SceneUnit['kind'], string> = {
  service: 'Организация',
  department: 'Департамент', directorate: 'Управление', division: 'Отдел', other: 'Подразделение',
};
const count = (value: number | null) => value === null ? 'нет данных' : value.toLocaleString('ru-RU');

/** Geometry uses scoped hierarchy data; a selection may open scoped employee pages. */
export default function OrgScene3D({ stats, staffUnits, divisionTree, onFallback, toolbarActions }: {
  stats: StaffUnitStatistics;
  staffUnits: StaffUnit[];
  divisionTree?: Division | null;
  onFallback?: () => void;
  toolbarActions?: ReactNode;
}) {
  const fullLayout = useMemo(() => buildSceneLayout(stats, staffUnits, divisionTree), [stats, staffUnits, divisionTree]);
  const [expandedIds, setExpandedIds] = useState<number[] | undefined>(undefined);
  const [revealId, setRevealId] = useState<number | null>(null);
  const layout = useMemo(() => selectSceneTree(fullLayout.nodes, expandedIds, revealId), [fullLayout, expandedIds, revealId]);
  const access = useOpsPermissions();
  const canReadPeople = !access.isLoading && !access.error && access.permissions !== undefined && access.hasPermission('personnel.view');
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef<SceneActions | null>(null);
  const selectedRef = useRef<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [search, setSearch] = useState('');
  const selected = fullLayout.nodes.find(node => node.id === selectedId) ?? null;
  const filtered = fullLayout.nodes.filter(node => [node.id, ...node.ancestors, node.name].join(' ').toLocaleLowerCase('ru-RU').includes(search.toLocaleLowerCase('ru-RU')));
  const selectUnit = (id: number) => {
    setSelectedId(id);
    if (layout.nodes.some(node => node.id === id)) actions.current?.focus(id);
    else { setExpandedIds(layout.expandedIds); setRevealId(id); }
  };
  const toggleBranch = (id: number) => {
    setRevealId(null);
    setExpandedIds(current => {
      const next = new Set(current ?? layout.expandedIds);
      // Keep previously revealed ancestry when changing an individual branch.
      for (const ancestor of layout.breadcrumbs.slice(0, -1)) next.add(ancestor.id);
      if (next.has(id)) next.delete(id); else next.add(id);
      return [...next];
    });
  };
  const toggleRef = useRef(toggleBranch);
  toggleRef.current = toggleBranch;

  useEffect(() => {
    selectedRef.current = selected?.id ?? null;
    actions.current?.select(selectedRef.current);
  }, [selected]);

  // OrbitControls removes its document keyboard listener via canvas.getRootNode().
  // Dispose before React detaches the host, while that root is still document.
  useLayoutEffect(() => {
    const container = host.current;
    if (!container || layout.nodes.length === 0) return;
    let cancelled = false;
    let stop = () => {};
    setState('loading');
    void (async () => {
      try {
        const [THREE, { OrbitControls }] = await Promise.all([
          import('three'), import('three/addons/controls/OrbitControls.js'),
        ]);
        if (cancelled) return;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
        const disposables = new Set<{ dispose: () => void }>();
        const labelSurfaces = new Set<HTMLCanvasElement>();
        const removers: Array<() => void> = [];
        let lost = false;
        let disposed = false;
        let frame: number | null = null;
        let hasRendered = false;
        const canvas = renderer.domElement;
        stop = () => {
          if (disposed) return;
          disposed = true;
          if (frame !== null) cancelAnimationFrame(frame);
          frame = null;
          actions.current = null;
          for (const remove of removers) remove();
          for (const resource of disposables) resource.dispose();
          disposables.clear();
          for (const surface of labelSurfaces) { surface.width = 0; surface.height = 0; }
          labelSurfaces.clear();
          renderer.dispose();
          renderer.forceContextLoss();
          canvas.remove();
        };
        const own = <T extends { dispose: () => void }>(resource: T): T => {
          disposables.add(resource);
          return resource;
        };
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        canvas.tabIndex = 0;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'Вращаемая 3D-сцена структуры организации');
        canvas.setAttribute('aria-describedby', 'org-scene-help');
        container.appendChild(canvas);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, layout.radius * 30);
        const controls = own(new OrbitControls(camera, canvas));
        controls.enableDamping = false;
        controls.autoRotate = false;
        controls.enablePan = true;
        controls.minDistance = 3;
        controls.maxDistance = layout.radius * 8;
        controls.maxPolarAngle = Math.PI * 0.86;
        scene.add(new THREE.HemisphereLight(0xffffff, 0x70839a, 2.7));
        const light = new THREE.DirectionalLight(0xffffff, 3);
        light.position.set(20, 45, 30);
        scene.add(light);
        const meshes = new Map<number, InstanceType<typeof THREE.Sprite>>();
        const materials = new Map<number, InstanceType<typeof THREE.SpriteMaterial>>();
        const pickables: InstanceType<typeof THREE.Object3D>[] = [];
        const colors = { service: '#304a7b', department: '#087f8c', directorate: '#5269c9', division: '#5b8b70', other: '#807297' };
        const cardWidth = 14;
        const cardHeight = 6.9;
        const labelWidth = 1040;
        const titleFontSize = 92;
        let spriteGeometry: InstanceType<typeof THREE.Sprite>['geometry'] | null = null;
        const labelTextures = new Map<number, { width: LabelTextureWidth; texture: InstanceType<typeof THREE.CanvasTexture>; surface: HTMLCanvasElement }>();
        const paintLabel = (node: SceneUnit, width: LabelTextureWidth) => {
          const surface = document.createElement('canvas');
          surface.width = width;
          surface.height = width * 512 / labelWidth;
          labelSurfaces.add(surface);
          const context = surface.getContext('2d');
          if (!context) throw new Error('Canvas labels unavailable');
          const scale = width / labelWidth;
          context.scale(scale, scale);
          const root = node.kind === 'service';
          const accent = root ? '#a9dbea' : colors[node.kind];
          context.shadowColor = '#23456830';
          // Canvas shadows are expressed in backing pixels, outside the transform.
          context.shadowBlur = 18 * scale;
          context.shadowOffsetY = 10 * scale;
          const fill = context.createLinearGradient(0, 12, 1040, 492);
          fill.addColorStop(0, root ? '#284c79' : '#ffffff');
          fill.addColorStop(1, root ? '#172c4a' : '#f5f9fc');
          context.fillStyle = fill;
          context.beginPath();
          context.roundRect(20, 12, 1000, 480, 32);
          context.fill();
          context.shadowBlur = 0;
          context.shadowOffsetY = 0;
          context.strokeStyle = root ? '#507397' : '#c9dbe5';
          context.lineWidth = 2;
          context.stroke();
          context.save();
          context.clip();
          context.fillStyle = root ? '#6bc7d7' : colors[node.kind];
          context.fillRect(20, 12, 1000, 9);
          context.fillStyle = root ? '#ffffff0c' : colors[node.kind] + '09';
          context.fillRect(20, 21, 1000, 81);
          context.restore();
          context.fillStyle = accent;
          context.font = '650 38px system-ui, sans-serif';
          context.fillText(kindLabels[node.kind].toLocaleUpperCase('ru-RU'), 62, 74);
          context.textAlign = 'right';
          context.font = '500 32px system-ui, sans-serif';
          context.fillText(`#${node.id}`, 974, 74);
          context.textAlign = 'left';
          context.fillStyle = root ? '#f4f9ff' : '#213b52';
          context.font = `650 ${titleFontSize}px system-ui, sans-serif`;
          const words = node.name.split(/\s+/);
          const lines: string[] = [];
          let current = '';
          for (const word of words) {
            const candidate = current ? current + ' ' + word : word;
            if (current && context.measureText(candidate).width > 908) { lines.push(current); current = word; }
            else current = candidate;
          }
          if (current) lines.push(current);
          lines.slice(0, 2).forEach((line, index) => {
            let text = line;
            const clipped = (index === 1 && lines.length > 2) || context.measureText(text).width > 908;
            while (context.measureText(text + (clipped ? '…' : '')).width > 908 && text.length > 1) text = text.slice(0, -1);
            context.fillText(text + (clipped ? '…' : ''), 62, 197 + index * 96);
          });
          context.fillStyle = root ? '#e3efff' : '#2b5068';
          context.font = '700 65px system-ui, sans-serif';
          const employeeCount = node.employees === null ? '—' : count(node.employees);
          context.fillText(employeeCount, 62, 370);
          const employeeWidth = context.measureText(employeeCount).width;
          context.fillStyle = root ? '#b7cbdf' : '#607d91';
          context.font = '46px system-ui, sans-serif';
          context.fillText(node.employees === null ? 'нет сводных данных' : 'сотрудников', 82 + employeeWidth, 368);
          context.fillStyle = root ? '#ffffff12' : colors[node.kind] + '0b';
          context.beginPath();
          context.roundRect(42, 402, 956, 70, 15);
          context.fill();
          context.fillStyle = accent;
          context.font = '600 48px system-ui, sans-serif';
          const children = layout.childCounts.get(node.id) ?? 0;
          context.fillText(children ? `${layout.expandedIds.includes(node.id) ? '− Свернуть ветвь' : '+ Раскрыть ветвь'} · ${children}` : 'Подробнее о подразделении', 62, 453);
          const texture = own(new THREE.CanvasTexture(surface));
          texture.colorSpace = THREE.SRGBColorSpace;
          // Downsample fine text within one mip level to avoid broken strokes
          // in the overview without blending across levels and softening titles.
          texture.minFilter = THREE.LinearMipmapNearestFilter;
          texture.generateMipmaps = true;
          texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          return { width, texture, surface };
        };
        const label = (node: SceneUnit) => {
          const record = paintLabel(node, 260);
          labelTextures.set(node.id, record);
          const texture = record.texture;
          const material = own(new THREE.SpriteMaterial({ map: texture, depthTest: true, depthWrite: false }));
          const sprite = new THREE.Sprite(material);
          // Sprite's default geometry is module-global and retains each renderer
          // through its dispose listeners. Own one shared clone per scene.
          if (!spriteGeometry) spriteGeometry = own(sprite.geometry.clone());
          sprite.geometry = spriteGeometry;
          sprite.scale.set(cardWidth, cardHeight, 1);
          sprite.position.set(node.position[0], node.position[1], node.position[2]);
          sprite.userData.unitId = node.id;
          pickables.push(sprite);
          meshes.set(node.id, sprite);
          materials.set(node.id, material);
          scene.add(sprite);
        };
        for (const node of layout.nodes) label(node);
        const branches: Array<{ from: number; to: number; material: InstanceType<typeof THREE.MeshPhongMaterial> }> = [];
        for (const edge of layout.edges) {
          const parent = meshes.get(edge.from)!.position;
          const child = meshes.get(edge.to)!.position;
          const start = parent.clone().add(new THREE.Vector3(0, -cardHeight / 2 + 0.2, -0.2));
          const end = child.clone().add(new THREE.Vector3(0, cardHeight / 2 - 0.2, -0.2));
          const rootBranch = layout.nodes.find(node => node.id === edge.from)?.kind === 'service';
          const curve = new THREE.CurvePath<InstanceType<typeof THREE.Vector3>>();
          // Every family has its own connector lane between generations.
          // Never route non-root branches through the service's central axis.
          const laneY = (start.y + end.y) / 2;
          const bend = Math.min(1.2, Math.abs(child.x - parent.x) / 2);
          const direction = Math.sign(child.x - parent.x);
          const cornerA = new THREE.Vector3(parent.x, laneY + bend, -0.2);
          const cornerB = new THREE.Vector3(parent.x + direction * bend, laneY, -0.2);
          const cornerC = new THREE.Vector3(child.x - direction * bend, laneY, -0.2);
          const cornerD = new THREE.Vector3(child.x, laneY - bend, -0.2);
          curve.add(new THREE.LineCurve3(start, cornerA));
          curve.add(new THREE.QuadraticBezierCurve3(cornerA, new THREE.Vector3(parent.x, laneY, -0.2), cornerB));
          curve.add(new THREE.LineCurve3(cornerB, cornerC));
          curve.add(new THREE.QuadraticBezierCurve3(cornerC, new THREE.Vector3(child.x, laneY, -0.2), cornerD));
          curve.add(new THREE.LineCurve3(cornerD, end));
          // Simple lit connectors avoid the PBR renderer's module-global DFG
          // texture, which retains disposed contexts in this Three version.
          const material = own(new THREE.MeshPhongMaterial({ color: '#7f9db3', shininess: 25 }));
          scene.add(new THREE.Mesh(own(new THREE.TubeGeometry(curve, 36, rootBranch ? 0.075 : 0.085, 6, false)), material));
          branches.push({ ...edge, material });
          const port = new THREE.Mesh(own(new THREE.SphereGeometry(0.12, 10, 8)), own(new THREE.MeshPhongMaterial({ color: colors[layout.nodes.find(node => node.id === edge.to)!.kind], shininess: 45 })));
          port.position.copy(end);
          scene.add(port);
        }
        const minY = Math.min(...layout.nodes.map(node => node.position[1]));
        const xs = layout.nodes.map(node => node.position[0]);
        const zs = layout.nodes.map(node => node.position[2]);
        const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
        const centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
        const center = new THREE.Vector3(centerX, (minY + Math.max(...layout.nodes.map(node => node.position[1]))) / 2, centerZ);
        const updateLabelResolution = () => {
          camera.updateMatrixWorld();
          const projected = new THREE.Vector3();
          const view = new THREE.Vector3();
          for (const node of layout.nodes) {
            const sprite = meshes.get(node.id)!;
            const current = labelTextures.get(node.id)!;
            view.copy(sprite.position).applyMatrix4(camera.matrixWorldInverse);
            const depth = -view.z;
            const widthNdc = sprite.scale.x * camera.projectionMatrix.elements[0] / depth;
            const heightNdc = sprite.scale.y * camera.projectionMatrix.elements[5] / depth;
            projected.copy(sprite.position).project(camera);
            // A wider exit boundary prevents allocation churn during small pans.
            // Offscreen cards never all upgrade merely because camera zoom changes.
            const margin = current.width > 260 ? 0.25 : 0.05;
            const visible = depth > camera.near && depth < camera.far &&
              projected.x + widthNdc / 2 >= -1 - margin && projected.x - widthNdc / 2 <= 1 + margin &&
              projected.y + heightNdc / 2 >= -1 - margin && projected.y - heightNdc / 2 <= 1 + margin;
            const width = labelTextureWidth(widthNdc * canvas.clientWidth / 2 * renderer.getPixelRatio(), current.width, visible);
            if (width === current.width) continue;
            // Three's uploaded texture storage has immutable dimensions. Replace
            // it and retain only the current source, not every historical tier.
            const next = paintLabel(node, width);
            materials.get(node.id)!.map = next.texture;
            labelTextures.set(node.id, next);
            current.texture.dispose();
            disposables.delete(current.texture);
            current.surface.width = 0;
            current.surface.height = 0;
            labelSurfaces.delete(current.surface);
          }
        };
        const draw = () => {
          frame = null;
          if (cancelled || disposed || lost) return;
          updateLabelResolution();
          renderer.render(scene, camera);
          canvas.dataset.nodes = layout.nodes.map(node => node.id).join(',');
          canvas.dataset.edges = layout.edges.map(edge => `${edge.from}:${edge.to}`).join(',');
          canvas.dataset.positions = JSON.stringify(layout.nodes.map(node => ({ id: node.id, parentId: node.parentId, position: node.position })));
          canvas.dataset.camera = [...camera.position.toArray(), ...controls.target.toArray()].map(value => value.toFixed(3)).join(',');
          canvas.dataset.bounds = JSON.stringify(layout.nodes.map(node => {
            const position = new THREE.Vector3(...node.position);
            const horizontal = new THREE.Vector3(cardWidth / 2, 0, 0).applyQuaternion(camera.quaternion);
            const vertical = new THREE.Vector3(0, cardHeight / 2, 0).applyQuaternion(camera.quaternion);
            const corners = [position.clone().sub(horizontal).sub(vertical).project(camera), position.clone().add(horizontal).add(vertical).project(camera)];
            return { id: node.id, left: corners[0].x, right: corners[1].x, bottom: corners[0].y, top: corners[1].y,
              titlePx: (corners[1].x - corners[0].x) * canvas.clientWidth / 2 * titleFontSize / labelWidth };
          }));
          if (!hasRendered) { hasRendered = true; setState('ready'); }
        };
        const render = () => {
          if (cancelled || disposed || lost || frame !== null) return;
          // Controls can emit several changes while fit/reset/focus computes
          // the final camera. Only allocate label tiers for the painted view.
          frame = requestAnimationFrame(() => {
            try { draw(); }
            catch {
              stop();
              if (!cancelled) setState('unavailable');
            }
          });
        };
        const fit = () => {
          const width = Math.max(...xs) - Math.min(...xs) + cardWidth + 3;
          const height = Math.max(...layout.nodes.map(node => node.position[1])) - minY + cardHeight + 9;
          const distance = Math.max(height, width / camera.aspect) / (2 * Math.tan(Math.PI / 8));
          camera.position.copy(center).add(new THREE.Vector3(0, 0, distance + Math.max(...zs) - centerZ));
          controls.target.copy(center);
          controls.update();
          render();
        };
        const reset = () => {
          fit();
          // Preserve a readable working scale as the organization grows.
          // The explicit fit action remains available for the complete outline.
          const distance = cardWidth * container.clientHeight * titleFontSize / labelWidth / (2 * Math.tan(Math.PI / 8) * 13);
          if (camera.position.distanceTo(controls.target) > distance) {
            const roots = layout.nodes.filter(node => node.parentId === null);
            if (roots.length === 1) controls.target.set(roots[0].position[0], roots[0].position[1] - 7.5, 0);
            camera.position.copy(controls.target).add(new THREE.Vector3(0, 0, distance));
            controls.update();
            render();
          }
        };
        const select = (id: number | null) => {
          for (const [key, material] of materials) {
            material.color.setHex(key === id ? 0xd0f2fa : 0xffffff);
            meshes.get(key)!.scale.set(cardWidth * (key === id ? 1.035 : 1), cardHeight * (key === id ? 1.035 : 1), 1);
          }
          const ancestry = new Set<number>();
          let current = layout.nodes.find(node => node.id === id);
          while (current && !ancestry.has(current.id)) { ancestry.add(current.id); current = layout.nodes.find(node => node.id === current!.parentId); }
          for (const branch of branches) branch.material.color.set(ancestry.has(branch.to) || branch.from === id ? '#13a8b7' : ('#7f9db3'));
          render();
        };
        const rotate = (horizontal: number, vertical: number) => { controls.rotateLeft(horizontal); controls.rotateUp(vertical); controls.update(); };
        const zoom = (closer: boolean) => { if (closer) controls.dollyIn(0.8); else controls.dollyOut(0.8); controls.update(); };
        const focus = (id: number) => {
          const sprite = meshes.get(id);
          if (!sprite) return;
          const node = layout.nodes.find(row => row.id === id)!;
          const children = layout.nodes.filter(row => row.parentId === id);
          const family = [node, ...children];
          if (!children.length && node.parentId !== null) {
            const parent = layout.nodes.find(row => row.id === node.parentId);
            if (parent) family.push(parent);
          }
          const familyXs = family.map(row => row.position[0]);
          const familyYs = family.map(row => row.position[1]);
          const width = Math.max(54, Math.max(...familyXs) - Math.min(...familyXs) + cardWidth + 8);
          const height = Math.max(32, Math.max(...familyYs) - Math.min(...familyYs) + cardHeight + 12);
          const distance = Math.max(height, width / camera.aspect) / (2 * Math.tan(Math.PI / 8));
          controls.target.set((Math.min(...familyXs) + Math.max(...familyXs)) / 2, (Math.min(...familyYs) + Math.max(...familyYs)) / 2, 0);
          camera.position.copy(controls.target).add(new THREE.Vector3(0, 0, distance));
          controls.update();
          select(id);
        };
        const pan = (direction: number) => {
          const delta = new THREE.Vector3(direction * 12, 0, 0).applyQuaternion(camera.quaternion);
          camera.position.add(delta); controls.target.add(delta);
          controls.update(); render();
        };
        actions.current = { rotate, zoom, reset, select, focus, fit, pan };
        controls.addEventListener('change', render);
        const resize = () => {
          const width = Math.max(1, container.clientWidth);
          const height = Math.max(1, container.clientHeight);
          renderer.setSize(width, height);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          reset();
          if (selectedRef.current !== null) focus(selectedRef.current);
        };
        const observer = new ResizeObserver(resize);
        observer.observe(container);
        removers.push(() => observer.disconnect(), () => controls.removeEventListener('change', render));
        let down: { x: number; y: number } | null = null;
        const pointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
        const pointerUp = (event: PointerEvent) => {
          if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) { down = null; return; }
          down = null;
          const rect = canvas.getBoundingClientRect();
          const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
          const ray = new THREE.Raycaster();
          ray.setFromCamera(pointer, camera);
          const hit = ray.intersectObjects(pickables, false)[0];
          if (hit) {
            const id = Number(hit.object.userData.unitId);
            setSelectedId(id);
            focus(id);
            // The bottom strip of each billboard is its explicit expansion action.
            if (hit.uv && hit.uv.y < 0.25 && (layout.childCounts.get(id) ?? 0) > 0) toggleRef.current(id);
          }
        };
        const keyDown = (event: KeyboardEvent) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(event.key)) return;
          event.preventDefault();
          if (event.key === 'Home') reset();
          else if (['+', '=', '-'].includes(event.key)) zoom(event.key !== '-');
          else if (event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) pan(event.key === 'ArrowLeft' ? -1 : 1);
          else rotate(event.key === 'ArrowLeft' ? 0.2 : event.key === 'ArrowRight' ? -0.2 : 0,
            event.key === 'ArrowUp' ? 0.15 : event.key === 'ArrowDown' ? -0.15 : 0);
        };
        const contextLost = (event: Event) => { event.preventDefault(); lost = true; if (!cancelled) setState('unavailable'); };
        canvas.addEventListener('pointerdown', pointerDown);
        canvas.addEventListener('pointerup', pointerUp);
        canvas.addEventListener('keydown', keyDown);
        canvas.addEventListener('webglcontextlost', contextLost);
        removers.push(() => canvas.removeEventListener('pointerdown', pointerDown), () => canvas.removeEventListener('pointerup', pointerUp),
          () => canvas.removeEventListener('keydown', keyDown), () => canvas.removeEventListener('webglcontextlost', contextLost));
        resize();
        reset();
        select(selectedRef.current);
        if (selectedRef.current !== null) focus(selectedRef.current);
      } catch {
        stop();
        if (!cancelled) setState('unavailable');
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [layout]);

  const unassignedNotice = fullLayout.unassignedStaffCount > 0 && (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <span>Без подразделения: {fullLayout.unassignedStaffCount} штатных строк. Сотрудники и вакансии доступны в таблице.</span>
      {onFallback && <Button variant="outline" size="sm" onClick={onFallback}>Показать в таблице</Button>}
    </div>
  );
  if (layout.nodes.length === 0) return <div className="space-y-3">{toolbarActions}{unassignedNotice}<p role="status">В вашей области пока нет подразделений для 3D-сцены.</p></div>;
  const controlsDisabled = state !== 'ready';
  return (
    <>
    {unassignedNotice}
    <section className={styles.scene} aria-label="3D-структура организации">
      <div className={styles.toolbar}>
        <div className={styles.heading}><span className={styles.headingIcon}><Network size={20} /></span><div><strong>Древо организации</strong><p>{stats.scope_division?.name ?? 'Доступные подразделения'}</p></div></div>
        <div className={styles.headerActions}>{toolbarActions ?? <span className={styles.liveBadge}>Интерактивная 3D-структура</span>}</div>
      </div>
      <div className={styles.scenePage}>
        <p role="status" data-testid="org-scene-visible">Показано {layout.nodes.length} из {fullLayout.nodes.length} подразделений · {layout.edges.length} связей</p>
        <div>
          <button type="button" onClick={() => { setExpandedIds(undefined); setRevealId(null); setSelectedId(null); actions.current?.reset(); }}>Свернуть ветви</button>
          {layout.rootCount > 1 && <span>Отдельные корни: {layout.rootCount}. Связи показаны только для известных родителей.</span>}
        </div>
      </div>
      <div className={styles.workspace}>
        <div className={styles.viewport}>
          <div ref={host} className={styles.canvasHost} data-testid="org-scene-canvas" />
          <div className={styles.sceneCaption}><span><i /> ОРГАНИЗАЦИОННАЯ СТРУКТУРА</span><p>Выберите подразделение, чтобы приблизить его ветвь</p></div>
          <div className={styles.buttons} aria-label="Управление 3D-сценой">
            <Button size="sm" variant="ghost" disabled={controlsDisabled} onClick={() => actions.current?.zoom(true)} aria-label="Приблизить" title="Приблизить"><Plus size={17} /></Button>
            <Button size="sm" variant="ghost" disabled={controlsDisabled} onClick={() => actions.current?.zoom(false)} aria-label="Отдалить" title="Отдалить"><Minus size={17} /></Button>
            <span />
            <Button size="sm" variant="ghost" disabled={controlsDisabled} onClick={() => actions.current?.pan(-1)} aria-label="Переместить вид влево" title="Переместить вид влево"><ArrowLeft size={16} /></Button>
            <Button size="sm" variant="ghost" disabled={controlsDisabled} onClick={() => actions.current?.pan(1)} aria-label="Переместить вид вправо" title="Переместить вид вправо"><ArrowRight size={16} /></Button>
            <Button size="sm" variant="ghost" disabled={controlsDisabled} onClick={() => actions.current?.fit()} aria-label="Вместить всё" title="Вместить всё"><Maximize2 size={16} /></Button>
            <Button size="sm" variant="ghost" disabled={controlsDisabled} onClick={() => actions.current?.reset()} aria-label="Сбросить вид" title="Сбросить вид"><RotateCcw size={16} /></Button>
          </div>
          {state === 'loading' && <p role="status" className={styles.overlay}>Подготовка 3D-сцены…</p>}
          {state === 'unavailable' && <div role="alert" className={styles.overlay}>
            <p>3D-сцена недоступна в этом браузере. Подразделения доступны в списке.</p>
            {onFallback && <Button variant="outline" onClick={onFallback}>Открыть таблицу</Button>}
          </div>}
          <div className={styles.legend} aria-label="Уровни структуры"><span>Организации и подразделения</span></div>
        </div>
        <aside className={styles.sidebar} aria-label="Подразделения и сведения">
          <label className={styles.searchLabel}><span>Подразделения <small>{fullLayout.nodes.length}</small></span><div><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Найти название или ID…" /></div></label>
          <div className={styles.unitList} role="group" aria-label="Выбор подразделения">
            {filtered.map(node => <button key={node.id} type="button" aria-pressed={selectedId === node.id} onClick={() => selectUnit(node.id)}>
              <span><i data-kind={node.kind} />{node.name}</span><small>{kindLabels[node.kind]} · #{node.id}</small>
            </button>)}
            {filtered.length === 0 && <p>Подразделения не найдены.</p>}
          </div>
          <div className={styles.details} aria-live="polite">
            {selected ? <>
              <span className={styles.detailKind}>{kindLabels[selected.kind]} · #{selected.id}</span>
              <h3>{selected.name}</h3>
              <p>{selected.ancestors.join(' › ') || kindLabels[selected.kind]}</p>
              {(layout.childCounts.get(selected.id) ?? 0) > 0 && <Button size="sm" variant="outline" aria-expanded={layout.expandedIds.includes(selected.id)} onClick={() => toggleBranch(selected.id)}>{layout.expandedIds.includes(selected.id) ? 'Свернуть подразделение' : 'Раскрыть подразделение'}</Button>}
              <dl><div><dt>Штатных единиц</dt><dd>{count(selected.staffCount)}</dd></div><div><dt>Сотрудников</dt><dd>{count(selected.employees)}</dd></div><div><dt>Вакансий</dt><dd>{count(selected.vacancies)}</dd></div></dl>
              {selected.source === 'staff' && <p>Подразделение найдено в штатном расписании; сводные данные для него не получены.</p>}
              {selected.source === 'hierarchy' && <p>Сводные данные по организации или подразделению не получены.</p>}
              {canReadPeople && <>
                <a href="#org-division-employees" className="inline-flex min-h-11 items-center font-semibold">Смотреть людей ↓</a>
                <Link href={`/service-employees?division_id=${selected.id}`}>Сотрудники подразделения →</Link>
              </>}
            </> : <div className={styles.emptyDetails}><Network size={26} /><h3>Исследуйте связи</h3><p>Выберите подразделение на дереве. Раскройте ветвь, чтобы увидеть его управления.</p></div>}
          </div>
        </aside>
      </div>
      <p id="org-scene-help" className={styles.help}>Перетаскивайте для вращения · Колесо для масштаба · Правая кнопка для перемещения <span>Клавиатура: стрелки, Shift + ← / →, + / −, Home</span></p>
    </section>
    {selected && canReadPeople && <DivisionEmployees key={selected.id} divisionId={selected.id} divisionName={selected.name} />}
    </>
  );
}
