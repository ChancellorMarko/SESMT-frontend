import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginDemo, openModule } from './helpers';

type Appearance = { opacity: number; transform: string; translate: string; scale: string; filter: string };
type CapturedAppearance = Appearance & { sampledAt: number; x: number; y: number; width: number; height: number; layoutHeight: number; hasControls: boolean };
type NativeAnimationCapture = {
  isAnimation: boolean; isCssAnimation: boolean; name: string; running: boolean; duration: number; finished: boolean;
  keyframes: { opacity: number; transform: string; offset: number }[];
};
type Capture = { frames: CapturedAppearance[]; done: boolean; animations: NativeAnimationCapture[]; animationEnds: string[] };

function observeErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return () => expect(errors).toEqual([]);
}

function appearance(locator: Locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element);
    return { opacity: Number(style.opacity), transform: style.transform, translate: style.translate, scale: style.scale, filter: style.filter };
  });
}

function movement(frame: Appearance) {
  return `${frame.transform}|${frame.translate}|${frame.scale}|${frame.filter}`;
}

// Begin observing before the user action so a short, real animation cannot finish
// while Playwright is waiting for the next element to become actionable.
async function captureNext(page: Page, selector: string, path?: string, heading?: string) {
  await page.evaluate(({ selector, path, heading }) => {
    const capture: Capture = { frames: [], done: false, animations: [], animationEnds: [] };
    (window as unknown as { __workspaceCapture: Capture }).__workspaceCapture = capture;
    let started = false;
    let samplingSince = 0;
    const observedAnimations = new Map<Animation, NativeAnimationCapture>();
    const ended = (event: AnimationEvent) => {
      if (event.target instanceof Element && event.target.matches(selector)) capture.animationEnds.push(event.animationName);
    };
    document.addEventListener('animationend', ended, true);
    const finishCapture = () => {
      capture.done = true;
      document.removeEventListener('animationend', ended, true);
    };
    const target = () => {
      if (path && location.pathname !== path) return null;
      if (heading && document.querySelector('main h1')?.textContent !== heading) return null;
      return document.querySelector<HTMLElement>(selector);
    };
    const sample = () => {
      const element = target();
      if (!element) { finishCapture(); return; }
      const sampledAt = performance.now();
      if (!samplingSince) samplingSince = sampledAt;
      const style = getComputedStyle(element);
      for (const animation of element.getAnimations()) {
        const known = observedAnimations.get(animation);
        if (known) { known.running ||= animation.playState === 'running'; continue; }
        if (!(animation.effect instanceof KeyframeEffect)) continue;
        const entry: NativeAnimationCapture = {
          isAnimation: animation instanceof Animation,
          isCssAnimation: animation instanceof CSSAnimation,
          name: animation instanceof CSSAnimation ? animation.animationName : '',
          running: animation.playState === 'running', duration: Number(animation.effect.getComputedTiming().duration), finished: false,
          keyframes: animation.effect.getKeyframes().map(frame => ({ opacity: Number(frame.opacity), transform: String(frame.transform ?? 'none'), offset: frame.computedOffset })),
        };
        observedAnimations.set(animation, entry);
        capture.animations.push(entry);
        void animation.finished.then(() => { entry.finished = true; }, () => {});
      }
      const bounds = element.getBoundingClientRect(), mainBounds = element.closest('main#conteudo')?.getBoundingClientRect();
      capture.frames.push({ sampledAt, opacity: Number(style.opacity), transform: style.transform, translate: style.translate, scale: style.scale, filter: style.filter,
        x: bounds.x - (mainBounds?.x || 0), y: bounds.y - (mainBounds?.y || 0), width: bounds.width, height: bounds.height, layoutHeight: element.offsetHeight,
        hasControls: element.matches('a[href],button,input,select,textarea,summary,[role="button"],[role="link"]') || Boolean(element.querySelector('a[href],button,input,select,textarea,summary,[role="button"],[role="link"]')) });
      if (sampledAt - samplingSince < 1_600) requestAnimationFrame(sample);
      else finishCapture();
    };
    const observer = new MutationObserver(() => {
      if (started || !target()) return;
      started = true;
      observer.disconnect();
      sample();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }, { selector, path, heading });
}

async function capturedFrames(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __workspaceCapture?: Capture }).__workspaceCapture?.done)).toBe(true);
  const frames = await page.evaluate(() => (window as unknown as { __workspaceCapture: Capture }).__workspaceCapture.frames);
  // CI may paint fewer frames; validate observed states and elapsed coverage, not a minimum FPS.
  expect(frames.length).toBeGreaterThanOrEqual(2);
  expect(frames.at(-1)!.sampledAt - frames[0].sampledAt).toBeGreaterThanOrEqual(1_600);
  return frames;
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.getByRole('scrollbar', { name: 'Rolagem da página', exact: true })).toHaveCount(0);
}

test('ações respondem ao hover e ao pressionar sem mover controles desabilitados', async ({ page }) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loginDemo(page, 'RH');
  await openModule(page, 'Trabalhadores');
  const action = page.getByRole('link', { name: 'Novo trabalhador', exact: true });
  await expect(action).toBeVisible();
  await page.mouse.move(0, 0);
  const rest = await appearance(action);
  const height = await action.evaluate(element => element.getBoundingClientRect().height);
  await action.hover();
  await expect.poll(async () => movement(await appearance(action))).not.toBe(movement(rest));
  const hovered = await appearance(action);
  await page.mouse.down();
  await expect.poll(async () => (await appearance(action)).scale).not.toBe(hovered.scale);
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/app\/trabalhadores(?:\?|$)/);
  await expect.poll(async () => movement(await appearance(action))).toBe(movement(rest));
  expect(await action.evaluate(element => element.getBoundingClientRect().height)).toBeCloseTo(height, 1);
  expect(height).toBeGreaterThanOrEqual(43.9);

  const previous = page.getByRole('button', { name: 'Anterior', exact: true });
  await expect(previous).toBeDisabled();
  const disabledRest = await appearance(previous);
  await previous.hover();
  expect(movement(await appearance(previous))).toBe(movement(disabledRest));
  await expectNoOverflow(page);
  verify();
});

test('troca de módulo anima o conteúdo sem recriar a área principal', async ({ page }) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loginDemo(page, 'RH');
  await page.evaluate(() => {
    (window as unknown as { __workspaceMain: Element | null }).__workspaceMain = document.querySelector('main#conteudo');
  });
  await captureNext(page, 'main#conteudo', '/app/trabalhadores', 'Trabalhadores');
  await openModule(page, 'Trabalhadores');
  const frames = await capturedFrames(page);
  expect(Math.min(...frames.map(frame => frame.opacity))).toBeLessThan(.95);
  expect(new Set(frames.map(movement)).size).toBeGreaterThan(1);
  expect(frames.at(-1)!.opacity).toBeGreaterThan(.99);
  expect(await page.evaluate(() => document.querySelector('main#conteudo') === (window as unknown as { __workspaceMain: Element | null }).__workspaceMain)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Trabalhadores', exact: true })).toBeFocused();

  await captureNext(page, 'main#conteudo .panel', '/app/trabalhadores/novo', 'Novo trabalhador');
  await page.getByRole('link', { name: 'Novo trabalhador', exact: true }).click();
  const panels = await capturedFrames(page);
  expect(Math.min(...panels.map(frame => frame.opacity))).toBeLessThan(.95);
  const paintedPanelIntermediate = panels.some(frame => frame.opacity > .15 && frame.opacity < .95);
  const panelAnimations = await page.evaluate(() => (window as unknown as { __workspaceCapture: Capture }).__workspaceCapture.animations);
  const completedNativeFade = panelAnimations.some(animation => animation.isAnimation && animation.running && animation.finished
    && Number.isFinite(animation.duration) && animation.duration > 0 && animation.keyframes.length >= 2
    && animation.keyframes[0].offset === 0 && animation.keyframes.at(-1)!.offset === 1
    && Number.isFinite(animation.keyframes[0].opacity) && Number.isFinite(animation.keyframes.at(-1)!.opacity)
    && animation.keyframes[0].opacity < .95 && animation.keyframes.at(-1)!.opacity > .99
    && animation.keyframes.at(-1)!.opacity - animation.keyframes[0].opacity > .05);
  // WAAPI fades have no CSS animationend event; completion proves progress at low FPS.
  expect(paintedPanelIntermediate || completedNativeFade).toBe(true);
  expect(panels.every(frame => frame.hasControls)).toBe(true);
  expect(new Set(panels.map(movement)).size).toBe(1);
  // The form fades without shifting controls; the main route may still move as a whole.
  for (const dimension of ['x', 'y', 'width'] as const) {
    const values = panels.map(frame => frame[dimension]);
    expect(Math.max(...values) - Math.min(...values), `Interactive panel ${dimension}`).toBeLessThanOrEqual(1);
  }
  // Loading feedback may change intrinsic form height; its painted height must match layout.
  expect(panels.every(frame => Math.abs(frame.height - frame.layoutHeight) <= 1)).toBe(true);
  expect(panels.at(-1)!.opacity).toBeGreaterThan(.99);
  await expect(page.getByLabel('Nome completo *', { exact: true })).toBeEditable();
  await expectNoOverflow(page);
  verify();
});

test('janela entra suavemente e continua acessível por teclado', async ({ page }) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loginDemo(page, 'RH');
  const trigger = page.getByRole('button', { name: 'Ajuda sobre o sistema', exact: true });
  await trigger.focus();
  await captureNext(page, '[role="dialog"][aria-modal="true"]');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Ajuda', exact: true });
  await expect(dialog).toBeFocused();
  const frames = await capturedFrames(page);
  const initialOpacity = Math.min(...frames.map(frame => frame.opacity));
  expect(initialOpacity).toBeLessThan(.95);
  const paintedIntermediate = frames.some(frame => frame.opacity > initialOpacity + .01 && frame.opacity < .99);
  const native = await page.evaluate(() => {
    const capture = (window as unknown as { __workspaceCapture: Capture }).__workspaceCapture;
    return { animations: capture.animations, animationEnds: capture.animationEnds };
  });
  const transitions = native.animations.filter(animation => animation.isAnimation && animation.isCssAnimation && animation.running
    && Number.isFinite(animation.duration) && animation.duration > 0 && animation.keyframes.length >= 2
    && animation.keyframes[0].offset === 0 && animation.keyframes.at(-1)!.offset === 1
    && Math.abs(animation.keyframes[0].opacity - animation.keyframes.at(-1)!.opacity) > .05
    && animation.keyframes[0].transform !== animation.keyframes.at(-1)!.transform);
  expect(transitions.length).toBeGreaterThan(0);
  // At low FPS, native completion proves interpolation even if rAF sampled only its endpoints.
  const completedNativeTransition = transitions.some(animation => animation.finished && native.animationEnds.includes(animation.name));
  expect(paintedIntermediate || completedNativeTransition).toBe(true);
  expect(new Set(frames.map(movement)).size).toBeGreaterThan(1);
  expect(frames.at(-1)!.opacity).toBeGreaterThan(.99);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Fechar janela', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Guia de siglas', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  verify();
});

test('movimento reduzido e largura320 preservam filtros, rascunho e foco', async ({ page }) => {
  const verify = observeErrors(page);
  const writes: string[] = [];
  page.on('request', request => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && /\/api\/v1\/workers(?:\/|$)/.test(new URL(request.url()).pathname)) writes.push(request.url());
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginDemo(page, 'RH');
  await captureNext(page, 'main#conteudo', '/app/trabalhadores', 'Trabalhadores');
  await openModule(page, 'Trabalhadores');
  const frames = await capturedFrames(page);
  expect(frames.every(frame => frame.opacity >= .99)).toBe(true);
  expect(new Set(frames.map(movement)).size).toBeLessThanOrEqual(1);
  const nativeAnimations = await page.evaluate(() => (window as unknown as { __workspaceCapture: Capture }).__workspaceCapture.animations);
  expect(nativeAnimations).toHaveLength(0);

  const search = page.getByLabel('Buscar nome ou matrícula', { exact: true });
  await search.fill('Ana');
  await search.evaluate(element => {
    (window as unknown as { __workspaceSearch: Element }).__workspaceSearch = element;
  });
  await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
  await expect(page).toHaveURL(/q=Ana/);
  await expect(search).toHaveValue('Ana');
  expect(await search.evaluate(element => element === (window as unknown as { __workspaceSearch: Element }).__workspaceSearch)).toBe(true);
  await expectNoOverflow(page);

  await page.getByRole('link', { name: 'Novo trabalhador', exact: true }).click();
  const name = page.getByLabel('Nome completo *', { exact: true });
  await name.fill('Rascunho com movimento reduzido');
  const formUrl = page.url();
  await page.getByRole('button', { name: 'Abrir navegação', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
  await menu.getByRole('link', { name: 'Documentos', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Alterações não salvas', exact: true });
  await expect(discard).toBeVisible();
  expect((await appearance(discard)).opacity).toBe(1);
  await discard.getByRole('button', { name: 'Continuar preenchendo', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(formUrl);
  await expect(name).toHaveValue('Rascunho com movimento reduzido');
  await name.focus();
  await expect(name).toBeFocused();
  await expectNoOverflow(page);
  expect(writes).toEqual([]);
  verify();
});
