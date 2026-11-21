import { expect, test, type Jardin } from '../helpers/jardin.ts';
import { enterRoam, roamAt, untilStill } from '../helpers/roam.ts';

// The grotto as a rock chamber under free roam (src/world/grotto.ts): a deep link sets the visitor down inside with the
// camera in the mouth; the visitor walks out to the Semillero and back in through the mouth, and the bed follows.
// Console errors fail every test (helpers/jardin.ts).

const bed = (j: Jardin): Promise<string | null> => j.withApi((api) => api.state().bed);
const camera = (j: Jardin): Promise<{ x: number; y: number; z: number }> => j.withApi((api) => api.camera());

test('roam grotto: the visitor stands in the chamber, walks out through the mouth and back in', async ({ page, jardin }) => {
  await enterRoam(jardin, '#/b/gruta');
  const at = await roamAt(jardin);
  expect(at.z, 'the visitor stands north of the back wall').toBeLessThan(-6.5);
  await expect.poll(async () => (await camera(jardin)).z, { message: 'the camera stands in the mouth' }).toBeLessThan(-6);
  await jardin.withApi((api) => api.walkTo(30.5, -2));
  await expect.poll(() => bed(jardin), { timeout: 15000 }).toBe('semillero');
  await untilStill(page);
  expect((await roamAt(jardin)).z, 'out in the garden').toBeGreaterThan(-5.5);
  await expect.poll(async () => (await camera(jardin)).z, { message: 'the follow camera is back' }).toBeGreaterThan(-2);
  await jardin.withApi((api) => api.walkTo(33.4, -8.6));
  await expect.poll(() => bed(jardin), { timeout: 15000 }).toBe('gruta');
  await untilStill(page);
  expect((await roamAt(jardin)).z, 'in the chamber again').toBeLessThan(-8);
});
