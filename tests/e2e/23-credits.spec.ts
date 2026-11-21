import { expect, test } from '../helpers/jardin.ts';
import { enterRoam } from '../helpers/roam.ts';

// The credits (src/credits/view.ts, ui/credits.route.ts): reached from the plan sheet in the garden, the Herbario footer
// or #/credits. An entry under a Creative Commons licence names its maker and links its licence; an attribution
// licence (CC BY, BY-SA) also prints its full credit line. The owner's own drawings and photograph have a section of
// their own, apart from the archive holders. Esc closes the view and goes back to where it was opened.

test('credits from the plan: maker and licence link of a CC entry, Esc goes back to the garden', async ({ page, jardin }) => {
  await enterRoam(jardin);
  const before = await jardin.hash();
  await page.locator('#proxies .pl-tag').click();
  const link = page.locator('#proxies .pl-credits');
  await expect(link).toHaveText('Credits');
  await link.click();

  const view = page.getByRole('dialog', { name: 'Credits' });
  await expect(view).toBeVisible();
  await expect.poll(() => jardin.hash()).toBe('#/credits');
  await expect(view.getByRole('heading', { level: 3, name: 'Images' })).toBeVisible();
  await expect(view.getByRole('heading', { level: 3, name: 'Fonts' })).toBeVisible();

  const own = view.getByRole('region', { name: 'Own work' });
  await expect(own.getByRole('heading', { level: 3, name: 'Own work' })).toBeVisible();
  await expect(own.locator('.cr-item[data-licence="OWN"]').first()).toBeVisible();
  await expect(own.locator('.cr-item:not([data-licence="OWN"])')).toHaveCount(0);
  await expect(own).toContainText('drawing');
  await expect(own).toContainText('photograph');
  await expect(view.getByRole('region', { name: 'Images' }).locator('.cr-item[data-licence="OWN"]'), 'own work is not listed again among the holders').toHaveCount(0);

  const entry = view.locator('.cr-item[data-licence^="CC"]').filter({ hasText: 'Changed:' }).first();
  await expect(entry.locator('.cr-who')).not.toBeEmpty();
  await expect(entry.locator('.cr-lic a')).toHaveAttribute('href', /^https:\/\//);
  await expect(entry.locator('.cr-lic')).toContainText('Changed:');
  for (const by of await view.locator('.cr-item[data-licence^="CC-BY"]').all()) await expect(by.locator('.cr-line')).not.toBeEmpty();

  await page.keyboard.press('Escape');
  await expect(view).toBeHidden();
  await expect.poll(() => jardin.hash()).toBe(before);
  await expect(link, 'focus returns to the link that opened the credits').toBeFocused();
  expect(jardin.errors).toEqual([]);
});

test('credits by URL in the Herbario, in Spanish; closing puts the album back on its place', async ({ page, jardin }) => {
  await jardin.visit({ hash: '#/credits', lang: 'es' });
  const view = page.getByRole('dialog', { name: 'Créditos' });
  await expect(view).toBeVisible();
  await expect(view.getByRole('heading', { level: 3, name: 'Tipografías' })).toBeVisible();
  await expect(view.getByRole('region', { name: 'Obra propia' }).getByRole('heading', { level: 3, name: 'Obra propia' })).toBeVisible();
  await view.getByRole('button', { name: 'Cerrar' }).click();
  await expect(view).toBeHidden();
  await expect.poll(() => jardin.hash()).toBe('#/');
  await page.locator('#herbario .h-credits').click();
  await expect(view).toBeVisible();
  expect(jardin.errors).toEqual([]);
});
