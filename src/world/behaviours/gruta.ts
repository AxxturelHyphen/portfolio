/**
 * Grotto behaviour (spec §16, ARCH 2.6 BedModule). P1 stub of the easter egg with real rules: the Coupé pushes a
 * dandelion seed-ball through a stone arch with 2D circle collisions, a goal shows the intertitle, the moth circles
 * and the counter goes up (localStorage, try/catch). Input is one real <button data-gruta-target> inside #proxies
 * (click, tap, Enter: the car lunges at the ball); the score lives in <output data-gruta-score>. Nothing here is
 * modal and nothing listens outside its own nodes, so opening or closing a project is never blocked.
 * The nodes are in the document only while the grotto is entered (its update runs only then), so a resident but
 * unvisited grotto adds nothing to the tab order or the accessibility tree. Every DOM write happens in stage 'dom'.
 */
import type { BedBehaviour, Clock, ScreenPt, State } from '../../types.ts';
import type { StreamBedCtx } from '../bed.ts';

const STORE_KEY = 'jardin.gruta.goals';

/** Game space in car radii; one game unit = GAME.unitOfBed x the bed width in world units. */
const GAME = {
  unitOfBed: 0.03,
  carR: 0.6,
  ballR: 0.4,
  ballX: 1.4,
  archX: 6,
  archHalfGap: 0.8,
  kickV: 5,
  restitution: 0.6,
  friction: 3,
  targetPx: 64,
} as const;

/** Durations of the stub game (seconds; to move into core/motion.ts with the P3 game). */
const GAME_S = { kick: 0.3, reset: 0.8, title: 1.5 } as const;

function readGoals(): number {
  try {
    const n = Number(window.localStorage.getItem(STORE_KEY) ?? '0');
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function writeGoals(n: number): void {
  try {
    window.localStorage.setItem(STORE_KEY, String(n));
  } catch {
    // storage blocked or full: the counter lives on in memory for this visit
  }
}

export default function gruta(ctx: StreamBedCtx): BedBehaviour {
  const found = document.getElementById('proxies');
  if (found === null) return {};
  const root: HTMLElement = found;
  const { scene, machine, rig, moth } = ctx;
  const say = (key: string): string => ctx.content.strings[machine.state.lang][key] ?? '[FILL]';

  const coupe = scene.slots.find((sl) => sl.id === 'coupe');
  /** Slots are in world coordinates. */
  const ox = coupe?.x ?? ctx.content.garden.anchors[scene.id];
  const oy = coupe?.y ?? 0;
  const oz = coupe?.z ?? 0;
  const unit = Math.abs(scene.bounds[1] - scene.bounds[0]) * GAME.unitOfBed;

  const wrap = document.createElement('div');
  wrap.dataset['gruta'] = '';
  wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;contain:strict';
  const target = document.createElement('button');
  target.type = 'button';
  target.dataset['grutaTarget'] = '';
  target.style.cssText = `position:absolute;left:${-GAME.targetPx / 2}px;top:${-GAME.targetPx / 2}px;width:${GAME.targetPx}px;height:${GAME.targetPx}px;border-radius:50%;border:1px dashed currentColor;background:transparent;pointer-events:auto`;
  const score = document.createElement('output');
  score.dataset['grutaScore'] = '';
  score.setAttribute('aria-live', 'polite');
  score.style.cssText = 'position:absolute;right:1rem;bottom:1rem;pointer-events:none';
  const title = document.createElement('p');
  title.dataset['grutaTitle'] = '';
  title.setAttribute('aria-hidden', 'true');
  title.style.cssText = 'position:absolute;left:50%;top:40%;margin:0;transform:translate(-50%,-50%);opacity:0;pointer-events:none';
  wrap.append(target, score, title);
  const mover = ctx.createMover(target);

  let goals = readGoals();
  const car = { x: 0, y: 0, vx: 0 };
  const ball = { x: GAME.ballX as number, y: 0, vx: 0, vy: 0 };
  let kickS = 0;
  let resetS = 0;
  let titleS = 0;
  let scored = false;
  /** The frame the grotto last ran (entered); the 'dom' stage mounts the nodes on that frame and removes them after. */
  let enteredFrame = -1;
  let titleShown = false;
  let shownGoals = -1;
  const pt: ScreenPt = { x: 0, y: 0, scale: 0, visible: false };

  function label(): void {
    target.setAttribute('aria-label', say('gruta.push'));
    score.setAttribute('aria-label', say('gruta.score'));
    title.textContent = say('gruta.goal');
  }
  label();

  const kick = (): void => {
    if (kickS > 0 || resetS > 0) return;
    kickS = GAME_S.kick;
    car.vx = GAME.kickV;
  };
  target.addEventListener('click', kick);

  function reset(): void {
    car.x = 0;
    car.vx = 0;
    ball.x = GAME.ballX;
    ball.y = 0;
    ball.vx = 0;
    ball.vy = 0;
    scored = false;
  }

  function collide(): void {
    const dx = ball.x - car.x;
    const dy = ball.y - car.y;
    const d = Math.hypot(dx, dy);
    const min = GAME.carR + GAME.ballR;
    if (d >= min || d < 1e-6) return;
    const nx = dx / d;
    const ny = dy / d;
    ball.x = car.x + nx * min;
    ball.y = car.y + ny * min;
    const vn = (car.vx - ball.vx) * nx - ball.vy * ny;
    if (vn <= 0) return;
    ball.vx += nx * vn * (1 + GAME.restitution);
    ball.vy += ny * vn * (1 + GAME.restitution);
  }

  function goal(): void {
    scored = true;
    goals++;
    writeGoals(goals);
    titleS = GAME_S.title;
    moth.celebrate();
    resetS = GAME_S.reset;
  }

  function step(dt: number): void {
    if (kickS > 0) {
      kickS -= dt;
      car.x += car.vx * dt;
      if (kickS <= 0) car.vx = 0;
    }
    collide();
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > 0) {
      const k = Math.max(0, speed - GAME.friction * dt) / speed;
      ball.vx *= k;
      ball.vy *= k;
    }
    const before = ball.x;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    if (!scored && before < GAME.archX && ball.x >= GAME.archX && Math.abs(ball.y) < GAME.archHalfGap) goal();
    if (resetS > 0) {
      resetS -= dt;
      if (resetS <= 0) reset();
    } else if (kickS <= 0 && ball.vx === 0 && ball.vy === 0 && ball.x !== GAME.ballX) {
      resetS = GAME_S.reset;
    }
    if (titleS > 0) titleS -= dt;
  }

  /** Stage 'dom': mount or unmount on entering or leaving, then transform, opacity and the counter, only on change. */
  function paint(c: Clock): void {
    const entered = enteredFrame === c.frame;
    if (entered !== wrap.isConnected) {
      if (entered) root.append(wrap);
      else wrap.remove();
      mover.reset();
    }
    if (!entered) return;
    mover.move(Math.round(pt.x), Math.round(pt.y), 1);
    const show = titleS > 0;
    if (show !== titleShown) {
      titleShown = show;
      title.style.opacity = show ? '1' : '0';
    }
    if (shownGoals !== goals) {
      shownGoals = goals;
      score.textContent = String(goals);
    }
  }
  const offDom = ctx.onDom(paint);

  return {
    update(c: Clock) {
      enteredFrame = c.frame;
      step(c.dt);
      rig.project(ox + ball.x * unit, oy + ball.y * unit, oz, pt);
    },
    onState(s: State, prev: State) {
      if (s.lang !== prev.lang) label();
    },
    dispose() {
      offDom();
      target.removeEventListener('click', kick);
      wrap.remove();
    },
  };
}
