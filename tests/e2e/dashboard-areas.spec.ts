import { expect, test, type Page } from '@playwright/test';
import { loginDemo } from './helpers';

test.setTimeout(30_000);

function quickNavigation(page: Page) {
  return page.getByRole('navigation', { name: 'Acesso rápido', exact: true });
}

function observePageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return () => expect(errors).toEqual([]);
}

async function expectNoGenericDashboard(page: Page) {
  await expect(page.getByRole('region', { name: 'Panorama de segurança do trabalho', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Operação da unidade selecionada', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Dias sem acidentes', exact: true })).toHaveCount(0);
  await expect(page.getByRole('progressbar', { name: 'Entregas de EPIs', exact: true })).toHaveCount(0);
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test('os acessos rápidos apresentam indicadores e seções próprios de cada área', async ({ page }) => {
  const verifyPageErrors = observePageErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginDemo(page, 'Engenheiro');
  const dock = quickNavigation(page);
  await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Operação da unidade selecionada', exact: true })).toBeVisible();

  await dock.getByRole('link', { name: 'Inspeções', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inspeções de segurança', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Onde estão os achados', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plano de ação das inspeções', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Roteiro de vistorias', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Filtrar ações de inspeção', exact: true }).getByRole('button', { name: 'Todas', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectNoGenericDashboard(page);

  await dock.getByRole('link', { name: 'Saúde e capacitações', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saúde ocupacional e capacitações', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Atestados de saúde ocupacional (ASO)', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fila de conferência documental', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Onde estão os achados', exact: true })).toHaveCount(0);
  await expectNoGenericDashboard(page);

  await dock.getByRole('link', { name: 'Equipamentos de proteção individual (EPI)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Equipamentos de proteção', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Entregas e comprovantes', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Conferências de EPIs', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Atestados de saúde ocupacional (ASO)', exact: true })).toHaveCount(0);
  await expectNoGenericDashboard(page);

  await dock.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Operação da unidade selecionada', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dias sem acidentes', exact: true })).toBeVisible();
  verifyPageErrors();
});

test('as abas ASOs e NRs diferenciam o conteúdo e preservam URL, teclado e histórico', async ({ page }) => {
  const verifyPageErrors = observePageErrors(page);
  await loginDemo(page, 'Engenheiro');
  await quickNavigation(page).getByRole('link', { name: 'Saúde e capacitações', exact: true }).click();
  const asos = page.getByRole('tab', { name: 'Saúde ocupacional · atestados de saúde ocupacional (ASO)', exact: true });
  const nrs = page.getByRole('tab', { name: 'Capacitações e normas regulamentadoras (NR)', exact: true });
  await expect(asos).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Atestados de saúde ocupacional (ASO)', exact: true })).toBeVisible();

  // Let the application router replace the current entry, then retain the
  // unrelated parameter through the tab controls and browser history.
  await page.evaluate(async () => {
    const url = new URL(location.href);
    url.searchParams.set('context', 'consulta-preservada');
    const routerUrl = '/src/app/router.tsx';
    const { getAppRouter } = await import(routerUrl);
    await getAppRouter().navigate(`${url.pathname}${url.search}`, { replace: true, flushSync: true });
  });
  await expect(page).toHaveURL(/context=consulta-preservada/);
  await asos.focus();
  await page.keyboard.press('ArrowRight');
  await expect(nrs).toBeFocused();
  await expect(nrs).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/healthView=nrs/);
  await expect(page.getByRole('heading', { name: 'Capacitações por equipe', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Planejamento de capacitações', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Atestados de saúde ocupacional (ASO)', exact: true })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('context')).toBe('consulta-preservada');
  expect(new URL(page.url()).searchParams.get('area')).toBe('saude');

  await page.keyboard.press('Home');
  await expect(asos).toBeFocused();
  await expect(asos).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Fila de conferência documental', exact: true })).toBeVisible();
  await page.keyboard.press('End');
  await expect(nrs).toBeFocused();
  await expect(nrs).toHaveAttribute('aria-selected', 'true');
  await asos.click();
  await expect(asos).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(nrs).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Capacitações por equipe', exact: true })).toBeVisible();
  await page.goForward();
  await expect(asos).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Atestados de saúde ocupacional (ASO)', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('context')).toBe('consulta-preservada');
  verifyPageErrors();
});

test('detalhes de inspeção e saúde atualizam acompanhamento e devolvem o foco', async ({ page }) => {
  const verifyPageErrors = observePageErrors(page);
  await loginDemo(page, 'Engenheiro');
  const writes: string[] = [];
  page.on('request', request => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && new URL(request.url()).pathname.startsWith('/api/v1/')) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  const dock = quickNavigation(page);
  await dock.getByRole('link', { name: 'Inspeções', exact: true }).click();
  const finding = page.getByRole('button', { name: 'Ver achado: Proteção de transmissão', exact: true });
  await finding.click();
  const findingDialog = page.getByRole('dialog', { name: 'Proteção de transmissão', exact: true });
  await findingDialog.getByRole('button', { name: 'Acompanhar', exact: true }).click();
  await expect(findingDialog.getByRole('status')).toContainText('Achado em acompanhamento.');
  await expect(findingDialog.getByRole('button', { name: 'Em acompanhamento', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(findingDialog).toHaveCount(0);
  await expect(finding).toBeFocused();
  await expect(page.getByText('Em acompanhamento', { exact: true })).toBeVisible();

  await dock.getByRole('link', { name: 'Saúde e capacitações', exact: true }).click();
  const documentDetail = page.getByRole('button', { name: 'Ver detalhe: Conferir identificação do documento', exact: true });
  await documentDetail.click();
  const documentDialog = page.getByRole('dialog', { name: 'Conferir identificação do documento', exact: true });
  await documentDialog.getByRole('button', { name: 'Acompanhar', exact: true }).click();
  await expect(documentDialog.getByRole('status')).toHaveText('Em acompanhamento');
  await expect(documentDialog.getByRole('button', { name: 'Retirar acompanhamento', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(documentDialog).toHaveCount(0);
  await expect(documentDetail).toBeFocused();
  await page.getByRole('tab', { name: 'Capacitações e normas regulamentadoras (NR)', exact: true }).click();
  const trainingDetail = page.getByRole('button', { name: 'Ver detalhe: Planejar orientação da manutenção', exact: true });
  await trainingDetail.click();
  const trainingDialog = page.getByRole('dialog', { name: 'Planejar orientação da manutenção', exact: true });
  await trainingDialog.getByRole('button', { name: 'Acompanhar', exact: true }).click();
  await expect(trainingDialog.getByRole('status')).toHaveText('Em acompanhamento');
  await expect(trainingDialog.getByRole('button', { name: 'Retirar acompanhamento', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(trainingDialog).toHaveCount(0);
  await expect(trainingDetail).toBeFocused();
  expect(writes).toEqual([]);
  verifyPageErrors();
});

test('os painéis cabem em 320px e mantêm a preferência de animação entre áreas', async ({ page }) => {
  const verifyPageErrors = observePageErrors(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loginDemo(page, 'Engenheiro');
  const settingsTrigger = page.getByRole('button', { name: 'Configurar animações', exact: true });
  await settingsTrigger.click();
  const settings = page.getByRole('dialog', { name: 'Animações da interface', exact: true });
  await settings.getByRole('radio', { name: /^Reduzidas/ }).check();
  await page.keyboard.press('Escape');
  await expect(settingsTrigger).toBeFocused();
  const dock = quickNavigation(page);

  for (const destination of [
    { link: 'Inspeções', heading: 'Onde estão os achados' },
    { link: 'Saúde e capacitações', heading: 'Atestados de saúde ocupacional (ASO)' },
    { link: 'Equipamentos de proteção individual (EPI)', heading: 'Equipamentos de proteção' },
  ]) {
    await dock.getByRole('link', { name: destination.link, exact: true }).click();
    await expect(page.getByRole('heading', { name: destination.heading, exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    await expect(page.locator('html')).toHaveAttribute('data-motion-preference', 'reduced');
    await expectNoOverflow(page);
  }

  await dock.getByRole('link', { name: 'Saúde e capacitações', exact: true }).click();
  await page.getByRole('tab', { name: 'Capacitações e normas regulamentadoras (NR)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Capacitações por equipe', exact: true })).toBeVisible();
  await expectNoOverflow(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  expect(await page.evaluate(() => localStorage.getItem('ampara.motionPreference'))).toBe('reduced');
  await expect(page.getByRole('scrollbar', { name: 'Rolagem da página', exact: true })).toHaveCount(0);
  verifyPageErrors();
});
