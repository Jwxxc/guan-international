import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const language = (page: Page) => page.getByRole('combobox', { name: 'Language / 语言' });
const cards = (page: Page) => page.getByTestId('hand-card');
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('guan.settings.v1')) localStorage.setItem('guan.settings.v1', JSON.stringify({ levelRank: 2, muted: true, musicEnabled: false, musicVolume: .22, reducedMotion: true, playMode: 'match', aiPolicy: 'coop-v2' }));
  });
  page.on('pageerror', error => { throw error; });
});
async function noUntranslatedText(page: Page) {
  const missing = await page.locator('body').evaluate(body => {
    const result: string[] = [];
    const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walk.nextNode())) {
      const el = node.parentElement;
      if (!el || el.closest('select,script,style') || !el.getClientRects().length) continue;
      if (/[\u3400-\u9fff]/.test(node.textContent ?? '')) result.push(node.textContent!);
    }
    return result;
  });
  expect(missing).toEqual([]);
}

test('English first, saved language choice, home controls and translated rules', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Start match', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'AI difficulty for new games' }).locator('option')).toHaveText(['Casual', 'Balanced', 'Balanced Plus', 'Balanced Pro', 'DanLM']);
  await noUntranslatedText(page);
  await mkdir('artifacts/international', { recursive: true });
  await page.screenshot({ path: `artifacts/international/home-en-${info.project.name}.png` });
  await language(page).selectOption('zh-CN');
  await expect(page.getByRole('button', { name: '开始升级赛', exact: true })).toBeVisible();
  await page.reload();
  await expect(language(page)).toHaveValue('zh-CN');
  await language(page).selectOption('en');
  await page.getByRole('button', { name: 'How to play', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Four players, two teams');
  await noUntranslatedText(page);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Statistics', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Team win rate');
  await noUntranslatedText(page);
});

test('switching language preserves paused cards, selection, policies and journals; play survives reload', async ({ page }) => {
  await page.goto('/?fixture=opening');
  await expect(cards(page)).toHaveCount(27);
  const last = cards(page).last();
  const id = await last.getAttribute('data-card-id');
  await last.click({ position: { x: 12, y: 20 } });
  await page.getByRole('button', { name: 'Pause & settings' }).click();
  const ids = await cards(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-card-id')));
  const snapshot = () => page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key !== 'guan.international.language.v1')));
  const before = await snapshot();
  await language(page).selectOption('zh-CN');
  await expect(page.getByRole('heading', { name: '暂停一下' })).toBeVisible();
  await language(page).selectOption('en');
  expect(await snapshot()).toEqual(before);
  expect(await cards(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-card-id')))).toEqual(ids);
  await expect(page.locator(`[data-testid="hand-card"][data-card-id="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Resume game', exact: true }).click();
  await page.getByTestId('play-button').click();
  await expect(cards(page)).toHaveCount(26);
  await page.getByRole('button', { name: 'Pause & settings' }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  // Leaving a dev fixture does not change the URL. Remove it before reloading,
  // otherwise the fixture intentionally boots a fresh hand again.
  await page.goto('/');
  await page.reload();
  await expect(language(page)).toHaveValue('en');
  await page.getByTestId('home-continue').click();
  await expect(cards(page)).toHaveCount(26);
  await noUntranslatedText(page);
});

for (const fixture of ['classic-tribute', 'classic-return', 'classic-anti', 'classic-reached-a', 'classic-a-not-passed', 'classic-complete']) {
  test(`English exchange/result/replay: ${fixture}`, async ({ page }) => {
    await page.goto(`/?match-fixture=${fixture}`);
    await expect(page.locator('.exchange-screen, [data-testid="results"]').first()).toBeVisible();
    await noUntranslatedText(page);
    const replay = page.getByRole('button', { name: 'Match replay', exact: true });
    if (await replay.isVisible()) {
      await replay.click();
      await expect(page.getByRole('button', { name: '← Exit replay', exact: true })).toBeVisible();
      await noUntranslatedText(page);
    }
  });
}

test('English hand tools remain separate and reachable at compact desktop sizes', async ({ page }, info) => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/?fixture=opening');
    for (let layout = 0; layout < 3; layout++) {
      await expect(page.getByTestId('hand-layout-trigger')).toBeVisible();
      const controls = [page.getByTestId('smart-arrange'), page.getByTestId('hand-straight-trigger'), page.getByTestId('hand-layout-trigger'), page.getByTestId('play-button')];
      const boxes = await Promise.all(controls.map(control => control.boundingBox()));
      for (const box of boxes) { expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height); }
      for (let i = 0; i < 2; i++) expect(boxes[i]!.x + boxes[i]!.width).toBeLessThanOrEqual(boxes[i + 1]!.x + 1);
      await page.getByTestId('hand-layout-trigger').click();
    }
    await page.screenshot({ path: `artifacts/international/table-${viewport.width}-${info.project.name}.png` });
    await noUntranslatedText(page);
    await page.getByTestId('hand-organize-trigger').click();
    await expect(page.getByRole('dialog', { name: 'Organize hand' })).toBeVisible();
    await noUntranslatedText(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});
