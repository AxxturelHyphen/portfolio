/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// One reader for the shot list: tests/shots.json (defaults) overridden by content/garden.json "shots" (world builders).

export interface ShotDef {
  id: string;
  name: string;
  wait: 'jardin' | 'dom';
  mode: 'garden' | 'herbario' | null;
  viewport: [number, number];
  t: number;
  refs: string[];
}

interface Manifest {
  defaultViewport: [number, number];
  shots: Record<string, { name: string; wait: 'jardin' | 'dom'; mode?: 'garden' | 'herbario'; viewport?: [number, number]; t: number; refs: string[] }>;
}

export function loadShots(root = resolve('.')): ShotDef[] {
  const m = JSON.parse(readFileSync(resolve(root, 'tests/shots.json'), 'utf8')) as Manifest;
  const gPath = resolve(root, 'content/garden.json');
  const g = existsSync(gPath) ? (JSON.parse(readFileSync(gPath, 'utf8')) as { shots?: Record<string, { t?: number; viewport?: [number, number] }> }) : {};
  return Object.entries(m.shots).map(([id, s]) => {
    const o = g.shots?.[id];
    return {
      id,
      name: s.name,
      wait: s.wait,
      mode: s.mode ?? null,
      viewport: o?.viewport ?? s.viewport ?? m.defaultViewport,
      t: o?.t ?? s.t,
      refs: s.refs,
    };
  });
}

/** 'S01,S03' to ids, validated against the manifest. */
export function pickShots(list: string, all: ShotDef[]): ShotDef[] {
  const want = list.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  const out: ShotDef[] = [];
  for (const id of want) {
    const s = all.find((x) => x.id === id);
    if (s === undefined) throw new Error(`unknown shot ${id}; known: ${all.map((x) => x.id).join(',')}`);
    out.push(s);
  }
  return out;
}
