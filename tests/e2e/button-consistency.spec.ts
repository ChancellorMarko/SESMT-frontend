import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

const documentPath = '/app/documentos/00000000-0000-4000-8000-000000000080';
const appointmentId = '00000000-0000-4000-8000-000000000221';

async function expectActionPattern(scope: Locator) {
  const actions = await scope.locator('.button').evaluateAll(elements => elements
    .filter(element => element.getBoundingClientRect().width > 0 && !element.closest('.tabs'))
    .map(element => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        label: element.getAttribute('aria-label') || element.textContent?.trim(),
        height: box.height,
        radius: style.borderTopLeftRadius,
        font: style.fontSize,
        weight: style.fontWeight,
        clipped: element.scrollWidth > element.clientWidth + 1,
        shrinkingIcons: Array.from(element.querySelectorAll('svg')).some(icon => getComputedStyle(icon).flexShrink !== '0'),
      };
    }));
  expect(actions.length).toBeGreaterThan(0);
  for (const action of actions) {
    expect.soft(action.height, `${action.label}: altura mínima`).toBeGreaterThanOrEqual(43.9);
    expect.soft(action.radius, `${action.label}: cantos`).toBe('12px');
    expect.soft(action.font, `${action.label}: tamanho do texto`).toBe('13px');
    expect.soft(action.weight, `${action.label}: peso do texto`).toBe('600');
    expect.soft(action.clipped, `${action.label}: conteúdo sem recorte`).toBe(false);
    expect.soft(action.shrinkingIcons, `${action.label}: ícones preservados`).toBe(false);
  }
}

async function expectPageWidth(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.getByRole('scrollbar', { name: 'Rolagem da página', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Controles de rolagem', exact: true })).toHaveCount(0);
}

for (const width of [1440, 768, 320]) {
  test(`ações de documento usam o mesmo padrão e preservam cancelamento em ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [], writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.method() !== 'GET' && /\/documents\//.test(request.url())) writes.push(request.url());
    });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginDemo(page);
    await navigateWithinApp(page, documentPath);
    await expect(page.getByRole('heading', { name: 'Inventário de riscos · Matriz (demo)', exact: true })).toBeVisible();
    const metadata = page.getByRole('region', { name: 'Metadados do documento', exact: true });
    const newVersion = metadata.getByRole('link', { name: 'Nova versão', exact: true });
    const archive = metadata.getByRole('button', { name: 'Arquivar', exact: true });
    await expect(newVersion).toBeVisible();
    await expect(archive).toBeVisible();
    await expectActionPattern(metadata);
    const newBox = await newVersion.boundingBox(), archiveBox = await archive.boundingBox();
    expect(newBox).not.toBeNull();
    expect(archiveBox).not.toBeNull();
    expect(Math.abs(newBox!.height - archiveBox!.height)).toBeLessThanOrEqual(1);
    await expectPageWidth(page);
    await page.screenshot({ path: testInfo.outputPath(`acoes-documento-${width}.png`) });

    await archive.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Arquivar documento', exact: true });
    await expect(dialog).toBeVisible();
    await expectActionPattern(dialog);
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(archive).toBeFocused();
    await expect(metadata.getByText('Vigente', { exact: true })).toBeVisible();
    expect(writes).toEqual([]);

    await newVersion.click();
    await expect(page.getByRole('heading', { name: 'Anexar nova versão', exact: true })).toBeVisible();
    await expectActionPattern(page.locator('#conteudo'));
    await expectPageWidth(page);
    await page.getByRole('link', { name: 'Voltar ao documento', exact: true }).click();
    await expect(page).toHaveURL(documentPath);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`listas e formulários mantêm ações legíveis sem rolagem lateral em ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginDemo(page, 'Engenheiro');
    const routes = [
      ['/app/documentos', 'Documentos'],
      ['/app/documentos/novo', 'Novo documento'],
      ['/app/trabalhadores', 'Trabalhadores'],
      ['/app/trabalhadores/novo', 'Novo trabalhador'],
      ['/app/equipes', 'Equipes de trabalho'],
      ['/app/equipes/novo', 'Nova equipe'],
      ['/app/agenda', 'Agenda de serviços'],
      ['/app/agenda/novo', 'Agendar serviço'],
      ['/app/pts', 'Permissões de trabalho'],
      ['/app/vencimentos?q=PGR', 'Vencimentos'],
      ['/app/notificacoes?read=false', 'Notificações'],
      ['/app/auditoria?action=DOCUMENT_CREATED', 'Auditoria'],
      ['/app/pendencias', 'Pendências documentais'],
      [`/app/ats/nova?appointmentId=${appointmentId}`, 'Criar Autorização de Trabalho'],
      [`/app/pets/nova?appointmentId=${appointmentId}`, 'Preparar PET'],
    ];
    for (const [path, heading] of routes) {
      await navigateWithinApp(page, path);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(page.locator('#conteudo .loading')).toHaveCount(0);
      await expectActionPattern(page.locator('#conteudo'));
      await expectPageWidth(page);
    }
    await page.getByRole('button', { name: 'Abrir navegação', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
    await menu.getByRole('link', { name: 'Permissões de trabalho', exact: true }).click();
    const discard = page.getByRole('dialog', { name: 'Alterações não salvas', exact: true });
    await expect(discard).toBeVisible();
    await expectActionPattern(discard);
    await discard.getByRole('button', { name: 'Descartar e sair', exact: true }).click();
    await expect(menu).toHaveCount(0);
    if (width === 768) await page.screenshot({ path: testInfo.outputPath('acoes-lista-pt-768.png') });
    await page.getByRole('link', { name: 'PT-DEMO-230', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Orientação da PT', exact: true })).toBeVisible();
    await expectActionPattern(page.locator('#conteudo'));
    await expectPageWidth(page);
    await page.locator('#conteudo').focus();
    const previousPosition = await page.evaluate(() => scrollY);
    await page.keyboard.press('PageDown');
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(previousPosition + 100);
    await page.screenshot({ path: testInfo.outputPath(`acoes-pt-${width}.png`) });
    expect(errors).toEqual([]);
  });
}

test('ações administrativas e seus diálogos seguem o padrão de 1440px a 320px', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginDemo(page, 'Administrador');
  for (const width of [1440, 768, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await navigateWithinApp(page, '/app/configuracoes/tipos-documentais');
    await expect(page.getByRole('heading', { name: 'Tipos documentais', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Editar política', exact: true }).first()).toBeVisible();
    await expectActionPattern(page.locator('#conteudo'));
    await expectPageWidth(page);
    await page.getByRole('button', { name: 'Novo tipo', exact: true }).click();
    const typeDialog = page.getByRole('dialog', { name: 'Novo tipo documental', exact: true });
    await expectActionPattern(typeDialog);
    await typeDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();

    await navigateWithinApp(page, '/app/configuracoes/usuarios');
    await expect(page.getByRole('heading', { name: 'Usuários e acesso', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alterar acesso', exact: true }).first()).toBeVisible();
    await expectActionPattern(page.locator('#conteudo'));
    await expectPageWidth(page);
    await page.getByRole('button', { name: 'Convidar usuário', exact: true }).click();
    const inviteDialog = page.getByRole('dialog', { name: 'Convidar usuário', exact: true });
    await expectActionPattern(inviteDialog);
    await inviteDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();

    await navigateWithinApp(page, '/app/organizacao');
    await expect(page.getByRole('heading', { name: 'Estrutura da organização', exact: true })).toBeVisible();
    const registers = page.getByLabel('Tipo de cadastro', { exact: true });
    const sectors = registers.getByRole('button', { name: /^Setores/ });
    const units = registers.getByRole('button', { name: /^Unidades/ });
    await sectors.click();
    await expect(sectors).toHaveAttribute('aria-pressed', 'true');
    await expect(units).toHaveAttribute('aria-pressed', 'false');
    await expect(sectors).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await units.click();
    await expect(units).toHaveAttribute('aria-pressed', 'true');
    await expect(sectors).toHaveAttribute('aria-pressed', 'false');
    await expect(units).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expectActionPattern(page.locator('#conteudo'));
    await expectPageWidth(page);
  }
});

test('consultar PT permanece legível entre tablet e desktop', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginDemo(page, 'Engenheiro');
  await navigateWithinApp(page, '/app/pts');
  const action = page.getByRole('link', { name: 'Consultar PT', exact: true }).first();
  await expect(action).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const width of [768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(action).toHaveCSS('height', '44px');
    const bounds = await action.boundingBox();
    expect(bounds?.width).toBeGreaterThan(120);
    await expectPageWidth(page);
    if (width === 768 || width === 1024) await page.screenshot({ path: testInfo.outputPath(`consulta-pt-${width}.png`), fullPage: true });
  }
});
