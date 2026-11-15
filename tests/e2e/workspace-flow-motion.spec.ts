import { expect, test, type Page } from '@playwright/test';
import { loginDemo, navigateWithinApp, openModule } from './helpers';

test.setTimeout(30_000);

type Frame = { opacity: number; height: number; transform: string; translate: string };
type Capture = { frames: Frame[]; done: boolean };
const unitId = '00000000-0000-4000-8000-000000000002';

function observeErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return () => expect(errors).toEqual([]);
}

// Start before interaction: short transitions must be sampled while they happen.
async function captureNext(page: Page, selector: string) {
  await page.evaluate(selector => {
    const capture: Capture = { frames: [], done: false };
    (window as unknown as { __flowCapture: Capture }).__flowCapture = capture;
    let attempts = 0, changedAt = -1;
    const sample = () => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) { if (++attempts < 300) requestAnimationFrame(sample); else capture.done = true; return; }
      const style = getComputedStyle(element);
      if (!capture.frames.length && (element.hidden || style.display === 'none')) { if (++attempts < 300) requestAnimationFrame(sample); else capture.done = true; return; }
      capture.frames.push({ opacity: Number(style.opacity), height: element.getBoundingClientRect().height, transform: style.transform, translate: style.translate });
      // Sample until the change has happened and settled, not for a fixed time: a slow click or render used to
      // spend the whole window before the transition started, making this test fail 2 of 3 runs.
      const key = (frame: Frame) => `${frame.opacity}|${Math.round(frame.height)}|${frame.transform}|${frame.translate}`;
      const count = capture.frames.length, last = key(capture.frames[count - 1]);
      if (changedAt < 0 && count > 1 && last !== key(capture.frames[0])) changedAt = count;
      const settled = changedAt >= 0 && count - changedAt >= 20 && capture.frames.slice(-20).every(frame => key(frame) === last);
      if (!settled && count < 180) requestAnimationFrame(sample);
      else capture.done = true;
    };
    requestAnimationFrame(sample);
  }, selector);
}

async function frames(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __flowCapture?: Capture }).__flowCapture?.done)).toBe(true);
  const result = await page.evaluate(() => (window as unknown as { __flowCapture: Capture }).__flowCapture.frames);
  expect(result.length).toBeGreaterThan(15);
  return result;
}

function expectEntrance(result: Frame[]) {
  expect(Math.min(...result.map(frame => frame.opacity))).toBeLessThan(.98);
  expect(result.at(-1)!.opacity).toBeGreaterThan(.99);
  expect(new Set(result.map(frame => `${frame.transform}|${frame.translate}`)).size).toBeGreaterThan(1);
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.getByRole('scrollbar', { name: 'Rolagem da página', exact: true })).toHaveCount(0);
}

test('agenda anima períodos no mesmo calendário e preserva a navegação por dia', async ({ page }) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loginDemo(page, 'Engenheiro');
  await navigateWithinApp(page, '/app/agenda?view=calendar&q=AG-DEMO-222&status=REQUESTED');
  const grid = page.getByRole('grid', { name: /^Calendário/ });
  await expect(grid.getByRole('link', { name: /^AG-DEMO-222:/ })).toBeVisible();
  await grid.evaluate(element => { (window as unknown as { __originalCalendar: Element }).__originalCalendar = element; });
  const originalMonth = await grid.getAttribute('aria-label');
  await captureNext(page, '[data-agenda-calendar-period]');
  await page.getByRole('button', { name: 'Próximo mês', exact: true }).click();
  expectEntrance(await frames(page));
  await expect(grid).not.toHaveAttribute('aria-label', originalMonth!);
  expect(await grid.evaluate(element => element === (window as unknown as { __originalCalendar: Element }).__originalCalendar)).toBe(true);
  expect(new URL(page.url()).searchParams.get('q')).toBe('AG-DEMO-222');
  expect(new URL(page.url()).searchParams.get('status')).toBe('REQUESTED');
  await page.getByRole('button', { name: 'Mês anterior', exact: true }).click();
  await expect(grid).toHaveAttribute('aria-label', originalMonth!);
  await page.getByRole('button', { name: 'Semanal', exact: true }).click();
  await expect(grid.getByRole('gridcell')).toHaveCount(7);
  const selected = grid.getByRole('button', { pressed: true });
  const selectedName = await selected.getAttribute('aria-label');
  await selected.focus();
  await page.keyboard.press('ArrowRight');
  await expect(grid.getByRole('button', { pressed: true })).toBeFocused();
  await expect(grid.getByRole('button', { pressed: true })).not.toHaveAttribute('aria-label', selectedName!);
  await expectNoOverflow(page);
  verify();
});

test('filtros abrem e fecham suavemente mantendo o campo e o valor digitado', async ({ page }) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loginDemo(page, 'Engenheiro');
  await openModule(page, 'Agenda');
  const toggle = page.getByRole('button', { name: 'Filtros avançados', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const id = (await toggle.getAttribute('aria-controls'))!;
  const selector = `[id=${JSON.stringify(id)}]`;
  await captureNext(page, selector);
  await toggle.click();
  const opened = await frames(page);
  expect(new Set(opened.map(frame => Math.round(frame.height))).size).toBeGreaterThan(2);
  const location = page.getByLabel('Local do serviço', { exact: true });
  await location.fill('Local preservado ao recolher');
  await location.evaluate(element => { (window as unknown as { __originalLocation: Element }).__originalLocation = element; });
  await captureNext(page, selector);
  await toggle.click();
  const closed = await frames(page);
  expect(new Set(closed.map(frame => Math.round(frame.height))).size).toBeGreaterThan(2);
  await expect(location).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await expect(location).toHaveValue('Local preservado ao recolher');
  expect(await location.evaluate(element => element === (window as unknown as { __originalLocation: Element }).__originalLocation)).toBe(true);
  await expect(page.getByLabel('Buscar atendimento', { exact: true })).toBeEditable();
  await expectNoOverflow(page);
  verify();
});

test('abas da consulta animam sem perder teclado e respeitam movimento reduzido em320px', async ({ page }) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loginDemo(page, 'Engenheiro');
  await openModule(page, 'Consulta central');
  const tabs = page.getByRole('tablist', { name: 'Abas de consulta', exact: true });
  const documents = tabs.getByRole('tab', { name: 'Documentos controlados', exact: true });
  const permits = tabs.getByRole('tab', { name: 'Permissões de trabalho (PT)', exact: true });
  await expect(page.getByRole('tabpanel')).toContainText('Buscar título ou código');
  await tabs.evaluate(element => { (window as unknown as { __originalTabs: Element }).__originalTabs = element; });
  const id = (await permits.getAttribute('aria-controls'))!;
  await captureNext(page, `[id=${JSON.stringify(id)}]`);
  await documents.focus();
  await page.keyboard.press('ArrowRight');
  expectEntrance(await frames(page));
  await expect(permits).toBeFocused();
  await expect(permits).toHaveAttribute('aria-selected', 'true');
  expect(await tabs.evaluate(element => element === (window as unknown as { __originalTabs: Element }).__originalTabs)).toBe(true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 950 });
  const docId = (await documents.getAttribute('aria-controls'))!;
  await captureNext(page, `[id=${JSON.stringify(docId)}]`);
  await page.keyboard.press('Home');
  const reduced = await frames(page);
  expect(reduced.every(frame => frame.opacity >= .99)).toBe(true);
  expect(new Set(reduced.map(frame => `${frame.transform}|${frame.translate}`)).size).toBe(1);
  await expect(documents).toBeFocused();
  const search = page.getByRole('searchbox', { name: 'Buscar título ou código', exact: true });
  await search.fill('Pesquisa ainda não aplicada');
  await expect(search).toHaveValue('Pesquisa ainda não aplicada');
  await expectNoOverflow(page);
  verify();
});

test('leitura e contador mudam só após a resposta e o sino não anima indefinidamente', async ({ page }) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loginDemo(page, 'Engenheiro');
  await navigateWithinApp(page, `/app/notificacoes?unitId=${unitId}`);
  const list = page.getByRole('region', { name: 'Lista de notificações', exact: true });
  const header = page.getByRole('link', { name: 'Abrir notificações', exact: true });
  await expect(list.getByRole('article')).toHaveCount(3);
  await expect(header).toHaveAccessibleDescription('3 notificações não lidas.');
  const first = list.getByRole('article').first();
  const title = (await first.getByRole('heading').innerText());
  const card = list.getByRole('article', { name: title, exact: true });
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    let release: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    (window as unknown as { __releaseRead: () => void }).__releaseRead = () => release();
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === 'PATCH' && /\/notifications\/[^/]+\/read(?:\?|$)/.test(url)) await gate;
      return original(input, init);
    };
  });
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'PATCH' && /\/notifications\/[^/]+\/read$/.test(new URL(request.url()).pathname)) writes.push(request.url()); });
  const mark = card.getByRole('button', { name: `Marcar como lida: ${title}`, exact: true });
  await mark.click();
  await expect(mark).toBeDisabled();
  await expect(mark).toHaveText('Registrando leitura…');
  await expect(card.getByText('Não lida', { exact: true })).toBeVisible();
  await expect(header).toHaveAccessibleDescription('3 notificações não lidas.');
  await page.evaluate(() => (window as unknown as { __releaseRead: () => void }).__releaseRead());
  await expect(card.getByText('Lida', { exact: true })).toBeVisible();
  await expect(header).toHaveAccessibleDescription('2 notificações não lidas.');
  await expect(mark).toHaveCount(0);
  expect(writes).toHaveLength(1);
  await page.mouse.move(0, 0);
  const restingBell = await header.locator('svg').evaluate(element => getComputedStyle(element).rotate);
  await header.hover();
  await expect.poll(() => header.locator('svg').evaluate(element => getComputedStyle(element).rotate)).not.toBe(restingBell);
  await expect.poll(() => header.evaluate(element => !element.getAnimations({ subtree: true }).some(animation => animation.effect?.getComputedTiming().iterations === Infinity))).toBe(true);
  await expect.poll(() => header.locator('svg').evaluate(element => getComputedStyle(element).rotate)).toBe(restingBell);
  await expectNoOverflow(page);
  verify();
});
