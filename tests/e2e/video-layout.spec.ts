import { expect, test, type Page } from '@playwright/test';
import { loginDemo, openModule } from './helpers';

type MotionFrame = { opacity: number; transform: string; filter: string; chart: string };
type MotionCapture = { frames: MotionFrame[]; done: boolean };

function observeErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return () => expect(errors).toEqual([]);
}

async function observeMotion(page: Page) {
  await page.addInitScript(() => {
    const capture: MotionCapture = { frames: [], done: false };
    (window as unknown as { __amparaMotion: MotionCapture }).__amparaMotion = capture;
    let sampling = false;
    function sample() {
      const card = document.querySelector<HTMLElement>('[data-motion-card]');
      const chart = document.querySelector<SVGElement>('[data-motion-chart]');
      if (!card) { capture.done = true; return; }
      let opacity = 1;
      const transforms: string[] = [], filters: string[] = [];
      for (let node: Element | null = card; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        opacity *= Number(style.opacity);
        if (style.transform !== 'none') transforms.push(style.transform);
        if (style.filter !== 'none') filters.push(style.filter);
      }
      const chartStyle = chart ? getComputedStyle(chart) : undefined;
      capture.frames.push({
        opacity,
        transform: transforms.join(' '),
        filter: filters.join(' '),
        chart: chart ? `${chartStyle?.strokeDasharray}|${chartStyle?.strokeDashoffset}|${chart.getAttribute('pathLength')}|${chart.getAttribute('stroke-dasharray')}|${chart.getAttribute('stroke-dashoffset')}` : '',
      });
      if (capture.frames.length < 120) requestAnimationFrame(sample);
      else capture.done = true;
    }
    const observer = new MutationObserver(() => {
      if (sampling || !document.querySelector('[data-motion-card]')) return;
      sampling = true;
      observer.disconnect();
      requestAnimationFrame(sample);
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

async function motionFrames(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __amparaMotion: MotionCapture }).__amparaMotion?.done)).toBe(true);
  return page.evaluate(() => (window as unknown as { __amparaMotion: MotionCapture }).__amparaMotion.frames);
}

async function expectInsideViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const content = await page.locator('main#conteudo').boundingBox();
  expect(content).not.toBeNull();
  expect(content!.x).toBeGreaterThanOrEqual(0);
  expect(content!.x + content!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1);
  await expect(page.getByRole('scrollbar', { name: 'Rolagem da página', exact: true })).toHaveCount(0);
}

test('entrada e gráfico realmente animam, hover responde e o diálogo devolve o foco', async ({ page }, testInfo) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await observeMotion(page);
  await loginDemo(page, 'Engenheiro');
  await page.getByText('Ver gráficos de segurança', { exact: true }).click();
  await expect(page.locator('[data-motion-card]').first()).toBeVisible();
  await expect(page.locator('main[data-motion-page]')).toBeVisible();
  const frames = await motionFrames(page);
  expect(frames.length).toBeGreaterThan(10);
  expect(Math.min(...frames.map(frame => frame.opacity))).toBeLessThan(.95);
  expect(frames.at(-1)!.opacity).toBeGreaterThan(.99);
  expect(new Set(frames.map(frame => `${frame.transform}|${frame.filter}`)).size).toBeGreaterThan(1);
  expect(new Set(frames.map(frame => frame.chart).filter(Boolean)).size).toBeGreaterThan(1);

  const card = page.locator('[data-motion-card]').first();
  const appearance = () => card.evaluate(element => {
    const style = getComputedStyle(element);
    return `${style.transform}|${style.boxShadow}|${style.borderColor}`;
  });
  const beforeHover = await appearance();
  await card.hover();
  await expect.poll(appearance).not.toBe(beforeHover);
  await page.mouse.move(0, 0);
  const information = page.getByRole('button', { name: 'Sobre o indicador: Dias sem acidentes', exact: true });
  await information.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Dias sem acidentes', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(information).toBeFocused();
  await expectInsideViewport(page);
  await page.screenshot({ path: testInfo.outputPath('dashboard-motion-final.png') });
  verify();
});

test('movimento reduzido entrega os cartões e o gráfico diretamente no estado final', async ({ page }) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await observeMotion(page);
  await loginDemo(page, 'Engenheiro');
  await expect(page.locator('[data-motion-card]').first()).toBeVisible();
  const frames = await motionFrames(page);
  expect(frames.length).toBeGreaterThan(10);
  expect(frames.every(frame => frame.opacity >= .99)).toBe(true);
  expect(new Set(frames.map(frame => `${frame.transform}|${frame.filter}`)).size).toBeLessThanOrEqual(1);
  expect(new Set(frames.map(frame => frame.chart).filter(Boolean)).size).toBeLessThanOrEqual(1);
  await expect(page.getByRole('progressbar', { name: 'Entregas de EPIs', exact: true })).toHaveAttribute('aria-valuenow', '92');
  verify();
});

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`rail, marca e módulos permanecem acessíveis em ${width}px`, async ({ page }, testInfo) => {
    const verify = observeErrors(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginDemo(page, 'Engenheiro');
    await expect(page.locator('[data-motion-card]').first()).toBeVisible();
    const logo = page.getByRole('link', { name: 'Ampara SESMT · Página inicial', exact: true }).getByAltText('Ampara SESMT', { exact: true });
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('src', '/brand/ampara/icon.png');
    const rail = page.getByRole('navigation', { name: 'Acesso rápido', exact: true });
    await expect(rail).toBeInViewport();
    const bounds = await rail.boundingBox();
    expect(bounds).not.toBeNull();
    if (width >= 1024) expect(bounds!.height).toBeGreaterThan(bounds!.width);
    else expect(bounds!.width).toBeGreaterThan(bounds!.height);
    for (const label of ['Visão geral', 'Inspeções', 'Saúde e capacitações', 'Equipamentos de proteção individual (EPI)', 'Relatórios']) {
      await expect(rail.getByRole('link', { name: label, exact: true })).toBeInViewport();
    }
    await expect(rail.getByRole('button', { name: 'Abrir navegação', exact: true })).toBeInViewport();
    await expectInsideViewport(page);
    await page.screenshot({ path: testInfo.outputPath(`dashboard-layout-${width}.png`) });
    await openModule(page, 'Documentos');
    await expect(page.getByRole('heading', { level: 1, name: 'Documentos', exact: true })).toBeFocused();
    await expectInsideViewport(page);
    await expect(page.getByRole('button', { name: 'Sair da plataforma', exact: true })).toBeVisible();
    verify();
  });
}

test('guia, menu e redimensionamento preservam o rascunho e o histórico protegido', async ({ page }, testInfo) => {
  const verify = observeErrors(page);
  const writes: string[] = [];
  page.on('request', request => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && /^\/api\/v1\/(workers|documents)(\/|$)/.test(new URL(request.url()).pathname)) writes.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginDemo(page, 'RH');
  const guideButton = page.getByRole('button', { name: 'Abrir Guia Ampara', exact: true });
  await guideButton.click();
  const guide = page.getByRole('dialog', { name: 'Guia Ampara', exact: true });
  await expect(guide).toBeVisible();
  await guide.getByRole('button', { name: 'Buscar módulos no guia', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole('link', { name: 'Trabalhadores', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(guide).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Trabalhadores', exact: true })).toBeFocused();
  const newWorker = page.getByRole('link', { name: 'Novo trabalhador', exact: true });
  await expect(newWorker).toBeVisible();
  const listUrl = page.url();
  await newWorker.click();
  const formUrl = page.url();
  const name = page.getByLabel('Nome completo *', { exact: true });
  await name.fill('Rascunho mantido no novo layout');
  await name.focus();
  await page.keyboard.press('Control+k');
  await expect(menu).toHaveCount(0);

  await page.getByRole('button', { name: 'Abrir navegação', exact: true }).focus();
  await page.keyboard.press('Enter');
  await menu.getByRole('link', { name: 'Documentos', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Alterações não salvas', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Continuar preenchendo', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(name).toHaveValue('Rascunho mantido no novo layout');
  await expect(page).toHaveURL(formUrl);

  await guideButton.click();
  await expect(guide).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  const guideBounds = await guide.boundingBox();
  expect(guideBounds).not.toBeNull();
  expect(guideBounds!.x).toBeGreaterThanOrEqual(0);
  expect(guideBounds!.x + guideBounds!.width).toBeLessThanOrEqual(321);
  await page.screenshot({ path: testInfo.outputPath('guia-mobile-320.png') });
  await page.keyboard.press('Escape');
  await expect(guideButton).toBeFocused();
  await expect(name).toHaveValue('Rascunho mantido no novo layout');
  await expectInsideViewport(page);
  await name.focus();
  await page.goBack();
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Continuar preenchendo', exact: true }).click();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Rascunho mantido no novo layout');
  await page.goBack();
  await discard.getByRole('button', { name: 'Descartar e sair', exact: true }).click();
  await expect(page).toHaveURL(listUrl);
  await page.goForward();
  await expect(page).toHaveURL(formUrl);
  await expect(name).toHaveValue('');
  expect(writes).toEqual([]);
  verify();
});
