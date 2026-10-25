import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginDemo, openModule } from './helpers';

test.setTimeout(30_000);

type Appearance = { opacity: number; transform: string; translate: string; scale: string };
type SurfaceAppearance = Appearance & { x: number; y: number; width: number; height: number; layoutHeight: number; hasControls: boolean };
type NavigationFrame = { main: Appearance; header: SurfaceAppearance; panel: SurfaceAppearance; headingFocused: boolean };
type NavigationCapture = { frames: NavigationFrame[]; done: boolean };

function observeErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return () => expect(errors).toEqual([]);
}

function appearance(locator: Locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element);
    return { opacity: Number(style.opacity), transform: style.transform, translate: style.translate, scale: style.scale };
  });
}

function position(value: Appearance) { return `${value.transform}|${value.translate}|${value.scale}`; }

async function chooseMotion(page: Page, label: 'Completas' | 'Reduzidas' | 'Seguir dispositivo') {
  const trigger = page.getByRole('button', { name: 'Configurar animações', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Animações da interface', exact: true });
  const choice = dialog.getByRole('radio', { name: new RegExp(`^${label}`) });
  await choice.check();
  await expect(choice).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

// Observe before routing, including the heading's automatic focus. Assertions use
// painted opacity/position rather than the existence of animation declarations.
async function captureWorkersNavigation(page: Page) {
  await page.evaluate(() => {
    const capture: NavigationCapture = { frames: [], done: false };
    (window as unknown as { __preferenceMotion: NavigationCapture }).__preferenceMotion = capture;
    let started = 0;
    const deadline = performance.now() + 8_000;
    const styleOf = (element: Element): Appearance => {
      const style = getComputedStyle(element);
      return { opacity: Number(style.opacity), transform: style.transform, translate: style.translate, scale: style.scale };
    };
    const surfaceOf = (element: HTMLElement, main: Element): SurfaceAppearance => {
      const bounds = element.getBoundingClientRect(), parentBounds = main.getBoundingClientRect();
      return { ...styleOf(element), x: bounds.x - parentBounds.x, y: bounds.y - parentBounds.y, width: bounds.width, height: bounds.height, layoutHeight: element.offsetHeight,
        hasControls: Boolean(element.querySelector('a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"]')) };
    };
    function sample() {
      const main = document.querySelector('main#conteudo');
      const heading = main?.querySelector('h1');
      const header = main?.querySelector<HTMLElement>('.page-header');
      const panel = main?.querySelector<HTMLElement>('.panel');
      if (location.pathname === '/app/trabalhadores' && heading?.textContent === 'Trabalhadores' && main && header && panel) {
        if (!started) started = performance.now();
        capture.frames.push({ main: styleOf(main), header: surfaceOf(header, main), panel: surfaceOf(panel, main), headingFocused: document.activeElement === heading });
      }
      if (started && performance.now() - started >= 1_600 || performance.now() >= deadline) capture.done = true;
      else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
}

async function navigationFrames(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __preferenceMotion: NavigationCapture }).__preferenceMotion?.done)).toBe(true);
  const result = await page.evaluate(() => (window as unknown as { __preferenceMotion: NavigationCapture }).__preferenceMotion.frames);
  expect(result.length).toBeGreaterThan(20);
  return result;
}

function expectVisibleFade(frames: Appearance[]) {
  expect(Math.min(...frames.map(frame => frame.opacity))).toBeLessThan(.95);
  expect(frames.some(frame => frame.opacity > .15 && frame.opacity < .95)).toBe(true);
  expect(frames.at(-1)!.opacity).toBeGreaterThan(.99);
}

function expectVisibleEntrance(frames: Appearance[]) {
  expectVisibleFade(frames);
  expect(new Set(frames.map(position)).size).toBeGreaterThan(1);
}

function expectStableInteractiveEntrance(frames: SurfaceAppearance[]) {
  expect(frames.every(frame => frame.hasControls)).toBe(true);
  expectVisibleFade(frames);
  expect(new Set(frames.map(position)).size).toBe(1);
  // Exclude the main route's entrance: controls must keep their geometry within it.
  for (const dimension of ['x', 'y', 'width'] as const) {
    const values = frames.map(frame => frame[dimension]);
    expect(Math.max(...values) - Math.min(...values), `Interactive surface ${dimension}`).toBeLessThanOrEqual(1);
  }
  // Loading feedback may change intrinsic height; the fade must not distort its layout box.
  expect(frames.every(frame => Math.abs(frame.height - frame.layoutHeight) <= 1)).toBe(true);
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test('Completas reativa CSS, página e painéis mesmo quando o dispositivo reduz movimento', async ({ page }) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginDemo(page, 'Engenheiro');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect(page.locator('html')).toHaveAttribute('data-motion-preference', 'system');
  const trigger = page.getByRole('button', { name: 'Configurar animações', exact: true });
  await trigger.click();
  const settings = page.getByRole('dialog', { name: 'Animações da interface', exact: true });
  await expect(settings.getByRole('radio', { name: /^Seguir dispositivo/ })).toBeChecked();
  await page.keyboard.press('Escape');
  await chooseMotion(page, 'Completas');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

  const action = page.getByRole('link', { name: 'Agendar serviço', exact: true });
  await page.mouse.move(0, 0);
  const resting = await appearance(action);
  await action.hover();
  await expect.poll(async () => position(await appearance(action))).not.toBe(position(resting));
  await page.mouse.move(0, 0);

  await captureWorkersNavigation(page);
  await openModule(page, 'Trabalhadores');
  const frames = await navigationFrames(page);
  expectVisibleEntrance(frames.map(frame => frame.main));
  expectStableInteractiveEntrance(frames.map(frame => frame.panel));
  expectStableInteractiveEntrance(frames.map(frame => frame.header));
  expect(frames.some(frame => frame.headingFocused && frame.header.opacity < .99)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Trabalhadores', exact: true })).toBeFocused();
  await expectNoOverflow(page);
  verify();
});

test('a preferência persiste após recarregar e entrar com outro perfil sem alterar a unidade atual', async ({ page }) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginDemo(page, 'Engenheiro');
  const unit = page.getByRole('combobox', { name: 'Unidade de trabalho', exact: true });
  const originalUnit = await unit.inputValue();
  const originalUrl = page.url();
  await chooseMotion(page, 'Completas');
  await expect(unit).toHaveValue(originalUnit);
  await expect(page).toHaveURL(originalUrl);
  expect(await page.evaluate(() => localStorage.getItem('ampara.motionPreference'))).toBe('full');

  // A reload deliberately resets the in-memory demo session; the browser's
  // visual preference must survive independently of the authenticated profile.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: 'RH', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
  await expect(page.getByRole('group', { name: /Perfil:.*Recursos Humanos/ })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  await page.getByRole('button', { name: 'Configurar animações', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Animações da interface', exact: true }).getByRole('radio', { name: /^Completas/ })).toBeChecked();
  await page.keyboard.press('Escape');
  verify();
});

test('Reduzidas desativa movimento de CSS, página e janelas apesar do dispositivo permitir animações', async ({ page }) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loginDemo(page, 'Engenheiro');
  await chooseMotion(page, 'Reduzidas');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
  const action = page.getByRole('link', { name: 'Agendar serviço', exact: true });
  await page.mouse.move(0, 0);
  const resting = await appearance(action);
  await action.hover();
  expect(position(await appearance(action))).toBe(position(resting));

  await captureWorkersNavigation(page);
  await openModule(page, 'Trabalhadores');
  const frames = await navigationFrames(page);
  for (const region of ['main', 'header', 'panel'] as const) {
    expect(frames.every(frame => frame[region].opacity >= .99)).toBe(true);
    expect(new Set(frames.map(frame => position(frame[region]))).size).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'Ajuda sobre o sistema', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sobre esta versão', exact: true });
  expect(await dialog.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  expect((await appearance(dialog)).opacity).toBe(1);
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  verify();
});

test('Seguir dispositivo reage em tempo real sem remontar ou perder um formulário em320px', async ({ page }) => {
  const verify = observeErrors(page);
  const writes: string[] = [];
  page.on('request', request => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && /\/api\/v1\/workers(?:\/|$)/.test(new URL(request.url()).pathname)) writes.push(request.url());
  });
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loginDemo(page, 'RH');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  await openModule(page, 'Trabalhadores');
  await page.getByRole('link', { name: 'Novo trabalhador', exact: true }).click();
  const name = page.getByLabel('Nome completo *', { exact: true });
  await name.fill('Rascunho preservado ao mudar movimento');
  await chooseMotion(page, 'Reduzidas');
  await chooseMotion(page, 'Seguir dispositivo');
  await expect(page.locator('html')).toHaveAttribute('data-motion-preference', 'system');
  await name.focus();
  await name.evaluate(element => {
    (window as unknown as { __motionPreferenceField: Element }).__motionPreferenceField = element;
  });
  for (const preference of ['reduce', 'no-preference'] as const) {
    await page.emulateMedia({ reducedMotion: preference });
    await expect(page.locator('html')).toHaveAttribute('data-motion', preference === 'reduce' ? 'reduced' : 'full');
    await expect(name).toHaveValue('Rascunho preservado ao mudar movimento');
    await expect(name).toBeFocused();
    expect(await name.evaluate(element => element === (window as unknown as { __motionPreferenceField: Element }).__motionPreferenceField)).toBe(true);
  }
  await expectNoOverflow(page);
  expect(writes).toEqual([]);
  verify();
});
