/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import type { JardinTestAPI } from '../../src/types.ts';

// Fixtures and a typed wrapper around the page for every e2e spec (cook/ARCH.md 2.11, spec section 11).
// Profile options come from tests/playwright.config.ts: `tierOpt` adds ?tier=low, `cpuThrottle` sets the CDP rate.

declare global {
  interface Window {
    __jardin?: JardinTestAPI;
  }
}

export interface Options {
  tierOpt: 'low' | null;
  cpuThrottle: number;
}

export interface Visit {
  /** Place hash, '#/' by default. */
  hash?: string;
  /** Default 'herbario': these flows need no WebGL. 'none' leaves the mode to the app's own decision. */
  mode?: 'garden' | 'herbario' | 'none';
  lang?: 'en' | 'es';
  /** Extra query params, e.g. { shot: 'S03', t: '12.5' }. */
  query?: Record<string, string>;
  /** The rail fallback (?roam=0) instead of free roam, the default. */
  rail?: boolean;
}

interface Proj { id: string; bed: string; title: string }
const raw = JSON.parse(readFileSync('content/projects.json', 'utf8')) as Proj[] | { projects: Proj[] };
export const PROJECTS: readonly Proj[] = Array.isArray(raw) ? raw : raw.projects;

/** First project of each bed that has one: used to cross beds in back and forward tests. */
export function projectsInDifferentBeds(): Proj[] {
  const seen = new Set<string>();
  const out: Proj[] = [];
  for (const p of PROJECTS) {
    if (seen.has(p.bed)) continue;
    seen.add(p.bed);
    out.push(p);
  }
  return out;
}

/** The one place that knows how a project is opened in Herbario (the title link of its sheet, delegated click). */
export const openTarget = (id: string): string => `article[data-flower="${id}"] .h-open`;

/** Selectors of the always-visible toggles (src/ui/toggles.ts), with the older Herbario header as a fallback. */
export const SEL = {
  gardenToggle: '#toggles [data-mode="garden"], .h-mode',
  modeToggle: '#toggles [data-mode], .h-mode',
  cv: '#toggles .tg-cv, .h-cv',
  lang: '#toggles [data-lang], .h-lang-switch',
} as const;

export class Jardin {
  readonly errors: string[] = [];
  readonly panel: Locator;
  constructor(readonly page: Page, readonly tier: 'low' | null) {
    this.panel = page.locator('dialog#panel');
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (m.location().url.endsWith('/favicon.ico')) return;
      this.errors.push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => this.errors.push(`pageerror: ${e.message}`));
  }

  url(v: Visit = {}): string {
    const q = new URLSearchParams();
    const mode = v.mode ?? 'herbario';
    if (mode !== 'none') q.set('mode', mode);
    if (v.lang) q.set('lang', v.lang);
    q.set('bench', '1');
    if (this.tier) q.set('tier', this.tier);
    if (v.rail === true) q.set('roam', '0');
    for (const [k, val] of Object.entries(v.query ?? {})) q.set(k, val);
    return `./?${q.toString()}${v.hash ?? '#/'}`;
  }

  async visit(v: Visit = {}): Promise<void> {
    await this.page.goto(this.url(v));
    await this.page.locator('html[data-mode]').waitFor({ state: 'attached' });
  }

  hash(): Promise<string> {
    return this.page.evaluate(() => location.hash);
  }

  /** Number of dialogs currently open in the document: the "one panel at most" invariant. */
  openDialogs(): Promise<number> {
    return this.page.evaluate(() => document.querySelectorAll('dialog[open]').length);
  }

  isPanelOpen(): Promise<boolean> {
    return this.page.evaluate(() => (document.getElementById('panel') as HTMLDialogElement | null)?.open === true);
  }

  /** Clicks the project's open link. `timeout` short on purpose when a modal may already cover it. */
  async open(id: string, timeout?: number): Promise<void> {
    await this.page.locator(openTarget(id)).click(timeout === undefined ? {} : { timeout });
  }

  /** Waits until the panel is open and shows the project title. */
  async expectOpen(p: Proj): Promise<void> {
    await expect(this.panel).toBeVisible();
    await expect(this.panel).toContainText(p.title);
    await expect.poll(() => this.hash()).toBe(`#/p/${p.id}`);
  }

  /** Waits until no dialog is open and the URL is back on a non-project place. */
  async expectClosed(): Promise<void> {
    await expect.poll(() => this.openDialogs(), { timeout: 5000 }).toBe(0);
    await expect.poll(async () => (await this.hash()).startsWith('#/p/'), { timeout: 5000 }).toBe(false);
  }

  mode(): Promise<string | undefined> {
    return this.page.evaluate(() => document.documentElement.dataset['mode']);
  }

  /** True when the test API is installed (needs ?bench=1 and the garden chunk). */
  hasApi(): Promise<boolean> {
    return this.page.evaluate(() => window.__jardin !== undefined);
  }

  /**
   * Garden flows: waits for window.__jardin and its ready promise, then runs `fn(api, arg)` inside the page.
   * `fn` is serialised: it must not close over test variables, pass them through `arg`.
   */
  async withApi<T, A = undefined>(fn: (api: JardinTestAPI, arg: A) => Promise<T> | T, arg?: A): Promise<T> {
    await this.page.waitForFunction(() => window.__jardin !== undefined, undefined, { timeout: 20000 });
    return this.page.evaluate(
      async ({ src, a }) => {
        const api = window.__jardin as JardinTestAPI;
        await api.ready;
        const f = (0, eval)(`(${src})`) as (x: JardinTestAPI, y: unknown) => unknown;
        return f(api, a);
      },
      { src: fn.toString(), a: arg },
    ) as Promise<T>;
  }

  /** Long tasks over `minMs` that started after the garden was ready (spec section 10: none after load). The observer is
   * installed before any page script by the guard fixture; `readyAt` is stamped here, after api.ready resolves. */
  async longTasksAfterReady(minMs = 100): Promise<Array<{ start: number; dur: number }>> {
    return this.withApi(async (api, min: number) => {
      await api.ready;
      const w = window as unknown as { __lt?: Array<[number, number]>; __readyAt?: number };
      w.__readyAt ??= performance.now();
      return (w.__lt ?? []).filter(([start, dur]) => start >= (w.__readyAt as number) && dur > min).map(([start, dur]) => ({ start, dur }));
    }, minMs);
  }

  /** api.goto: resolves when every channel is settled and the bed is active. */
  goto(hash: string, instant = false): Promise<void> {
    return this.withApi((api, a: { h: string; i: boolean }) => api.goto(a.h, { instant: a.i }), { h: hash, i: instant });
  }

  /** api.settled: every channel at rest. */
  async settled(): Promise<void> {
    const stuck = await this.withApi((api) =>
      Promise.race([
        api.settled().then(() => null),
        new Promise<string>((ok) => setTimeout(() => ok(`${JSON.stringify(api.state())} roam ${JSON.stringify(api.roam())} boss ${api.boss()}`), 90000)),
      ]),
    );
    if (stuck !== null) throw new Error(`not settled after 90 s: ${stuck}`);
  }
}

type Fixtures = { jardin: Jardin; guard: void };

export const test = base.extend<Fixtures & Options>({
  tierOpt: [null, { option: true }],
  cpuThrottle: [1, { option: true }],
  jardin: async ({ page, tierOpt }, use) => {
    await use(new Jardin(page, tierOpt));
  },
  // Auto fixture: CPU throttle through CDP before any navigation, and "no console errors" as a hard end condition.
  guard: [
    async ({ page, context, jardin, cpuThrottle }, use) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __lt: Array<[number, number]> };
        w.__lt = [];
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) w.__lt.push([e.startTime, e.duration]);
        }).observe({ type: 'longtask', buffered: true });
      });
      if (cpuThrottle > 1) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
      }
      await use();
      expect(jardin.errors, 'console errors and page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export const isLow = (tier: 'low' | null): boolean => tier === 'low';
