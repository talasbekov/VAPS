'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useSectionNavigation } from '@/components/navigation/section-navigation';
import { useOpsReadAccess, useOpsProtectedRead } from '@/hooks/use-ops-protected-read';
import { opsApiClient } from '@/lib/ops-api';
import { loadAstanaMapAsset, peekAstanaMapAsset, type AstanaMapAsset } from '@/features/offline-map/model/asset';
import { backgroundDay, MAP_DWELL_MS, MAP_FADE_MS, pointInBounds, readBackgroundScenes, type BackgroundScene } from '../model/scenes';
import MapBackdrop from './MapBackdrop';
import styles from './AmbientBackground.module.css';

function AmbientBackgroundContent() {
  const { sectionId } = useSectionNavigation();
  const section = sectionId ?? 'personal';
  const access = useOpsReadAccess('event.view');
  const [day, setDay] = useState(backgroundDay);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [paused, setPaused] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [fading, setFading] = useState(false);
  const [asset, setAsset] = useState<AstanaMapAsset | null>(peekAstanaMapAsset);
  const [assetError, setAssetError] = useState(false);
  const [painted, setPainted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const query = useOpsProtectedRead(['ops-ambient-background', 'scenes'], [day], access,
    signal => readBackgroundScenes(path => opsApiClient.get<unknown>(path), day, signal),
    { staleTime: 300_000, poll: () => 300_000 });

  useEffect(() => {
    try {
      setPaused(sessionStorage.getItem('sj-ambient-paused') === 'true');
      const saved = Number(sessionStorage.getItem('sj-ambient-cursor'));
      if (Number.isSafeInteger(saved) && saved >= 0 && saved < 1_000_000_000) setCursor(saved);
    } catch { /* UI preferences remain local to this mount without storage. */ }
    setPreferencesReady(true);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(media.matches);
    const visibility = () => { setVisible(!document.hidden); setDay(backgroundDay()); };
    motion(); visibility();
    media.addEventListener('change', motion); document.addEventListener('visibilitychange', visibility);
    const timer = setInterval(() => { if (!document.hidden) setDay(backgroundDay()); }, 60_000);
    return () => { clearInterval(timer); media.removeEventListener('change', motion); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => {
    if (!preferencesReady) return;
    try { sessionStorage.setItem('sj-ambient-paused', String(paused)); sessionStorage.setItem('sj-ambient-cursor', String(cursor)); } catch { /* No storage requirement. */ }
  }, [paused, cursor, preferencesReady]);
  useEffect(() => {
    let current = true;
    setAssetError(false);
    loadAstanaMapAsset().then(next => { if (current) setAsset(next); }).catch(() => { if (current) setAssetError(true); });
    return () => { current = false; };
  }, [attempt]);

  // canAct excludes disabled, retained-error, refreshing and revoked-scope payloads.
  const scenes = useMemo<BackgroundScene[]>(() => {
    if (!asset) return [];
    const allowed = query.canAct ? (query.data ?? []).filter(scene => pointInBounds(scene.center, asset.manifest.bounds)) : [];
    return allowed.length ? allowed : [{ key: 'astana', kind: 'astana', label: 'Астана', center: asset.manifest.center }];
  }, [asset, query.canAct, query.data]);
  const scene = scenes.length ? scenes[cursor % scenes.length] : undefined;
  const next = scenes.length > 1 ? scenes[(cursor + 1) % scenes.length] : undefined;
  const playlist = `${access.scope}:${scenes.map(item => item.key).join('|')}`;
  const motion = preferencesReady && visible && !reduced && !paused;
  useEffect(() => {
    if (scenes.length <= 1) { setFading(false); return; }
    if (!motion || fading) return;
    const timer = setTimeout(() => setFading(true), MAP_DWELL_MS);
    return () => clearTimeout(timer);
  }, [playlist, scenes.length, fading, motion]);
  const ready = useCallback(() => setPainted(true), []);
  const failed = useCallback(() => setAssetError(true), []);
  const mode = reduced ? 'reduced' : motion ? 'running' : 'paused';
  const label = assetError ? 'Фон карты недоступен' : !asset || !painted ? 'Загрузка фона карты…' : `Фон: ${scene?.label ?? 'Астана'}`;

  return <>
    <div className={styles.backdrop} data-testid="ambient-background" data-section={section} data-motion={mode}
      data-source={assetError ? 'unavailable' : scene?.kind ?? 'loading'} aria-hidden="true">
      {asset && !assetError && scene && <div className={styles.mapSurface}>
        {[scene, ...(next ? [next] : [])].map((item, index) => <div key={`${access.scope}:${item.key}`} className={`${styles.mapLayer} ${index ? styles.incoming : ''} ${index && fading ? styles.fading : ''}`}
          style={index ? { animationDuration: `${MAP_FADE_MS}ms` } : undefined}
          onAnimationEnd={index && fading ? event => {
            if (event.target !== event.currentTarget) return;
            setCursor(value => (value + 1) % 1_000_000_000); setFading(false);
          } : undefined}>
          <div className={styles.drift}><MapBackdrop asset={asset} scene={item} className={styles.canvas} onReady={ready} onError={failed} /></div>
        </div>)}
        <div className={styles.veil} />
      </div>}
    </div>
    <div className={styles.toolbar} aria-label="Фон раздела">
      <span className={styles.label} title={label}>{label}</span>
      {asset && !assetError && <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" title="© OpenStreetMap contributors · ODbL 1.0">© OpenStreetMap</a>}
      {assetError && <button type="button" onClick={() => { setPainted(false); setAsset(null); setAttempt(value => value + 1); }}>Повторить карту</button>}
      <button type="button" aria-label={paused ? 'Продолжить движение фона' : 'Приостановить движение фона'} aria-pressed={paused}
        disabled={reduced} title={reduced ? 'Движение отключено настройками системы' : paused ? 'Продолжить движение фона' : 'Приостановить движение фона'} onClick={() => setPaused(value => !value)}>
        {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}<span>{reduced ? 'Фон статичен' : paused ? 'Продолжить' : 'Пауза'}</span>
      </button>
    </div>
  </>;
}

export function AmbientBackground() {
  return <Suspense fallback={null}><AmbientBackgroundContent /></Suspense>;
}
