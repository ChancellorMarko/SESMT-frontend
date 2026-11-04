import { expect, test, type Page } from '@playwright/test';
import { loginDemo, openModule } from './helpers';

const password = 'Senha pessoal de teste 2026';

async function invite(page: Page, { name, email, role, ownOnly = false }: { name: string; email: string; role: string; ownOnly?: boolean }) {
  await loginDemo(page, 'Administrador');
  await openModule(page, 'Usuários e acessos');
  await expect(page.getByRole('heading', { name: 'Usuários e acesso', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Convidar usuário', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Convidar usuário', exact: true });
  await dialog.getByLabel('Nome', { exact: true }).fill(name);
  await dialog.getByLabel('E-mail', { exact: true }).fill(email);
  await dialog.getByLabel(role, { exact: true }).check();
  await dialog.getByLabel('Organização Exemplo', { exact: true }).check();
  await dialog.getByLabel('Unidade Matriz', { exact: true }).check();
  if (ownOnly) await dialog.getByLabel('Restringir aos dados próprios', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Enviar convite', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const person = page.getByRole('row').filter({ hasText: email });
  await expect(person).toContainText('Convidado');
  await person.getByRole('button', { name: 'Consultar convite', exact: true }).click();
  const invitation = page.getByRole('dialog', { name: 'Convite de conta', exact: true });
  await expect(invitation.getByText('Aguardando ativação', { exact: true })).toBeVisible();
  await expect(invitation.getByText('Envio não realizado', { exact: true })).toBeVisible();
  return invitation;
}

async function beginActivation(page: Page) {
  await page.getByRole('link', { name: 'Definir primeiro acesso', exact: true }).click();
  await expect(page).toHaveURL(/\/ativar-acesso#token=/);
  await expect(page.getByRole('heading', { name: 'Já existe uma conta aberta', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sair e continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seu primeiro acesso', exact: true })).toBeVisible();
  const first = page.getByLabel('Nova senha', { exact: true });
  await expect(first).toBeVisible(); await expect(first).toBeFocused();
  await first.fill(password);
  await page.getByLabel('Confirmar nova senha', { exact: true }).fill(password);
  return first;
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test('convite administrativo chega ao primeiro acesso em 320px, define senha e exige login explícito', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const email = 'primeiro.rh@example.invalid';
  const summary = await invite(page, { name: 'Pessoa RH de demonstração', email, role: 'Recursos Humanos' });
  await page.screenshot({ path: testInfo.outputPath('account-invitation-desktop.png'), animations: 'disabled' });
  await expect(summary).toContainText('A própria pessoa conclui pelo convite');
  const first = await beginActivation(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await noOverflow(page);
  await page.getByRole('button', { name: 'Mostrar nova senha', exact: true }).click();
  await expect(first).toHaveAttribute('type', 'text'); await expect(first).toHaveValue(password);
  await page.getByRole('button', { name: 'Ocultar nova senha', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('account-activation-mobile-320.png'), animations: 'disabled', fullPage: true });
  await page.getByRole('button', { name: 'Ativar minha conta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sua conta está pronta', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/ativar-acesso#token=/);
  const toLogin = page.getByRole('link', { name: 'Ir para o login', exact: true });
  await expect(toLogin).toBeFocused(); await noOverflow(page);
  await toLogin.click();
  await expect(page.getByRole('heading', { name: 'Entrar na sua conta', exact: true })).toBeVisible();
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await expect(page.getByRole('button', { name: 'Sair da plataforma', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Convidar usuário', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const scenario of [
  { name: 'nova conta administradora', person: 'Administrador convidado', email: 'primeiro.admin@example.invalid', role: 'Administrador', ownOnly: false, guidance: 'A configuração inicial do autenticador ainda depende da liberação deste ambiente.', loginError: 'A configuração do autenticador ainda depende da integração de identidade' },
  { name: 'nova conta com dados próprios', person: 'Trabalhador convidado', email: 'primeiro.worker@example.invalid', role: 'Trabalhador', ownOnly: true, guidance: 'Peça ao administrador para confirmar o vínculo com o trabalhador.', loginError: 'O vínculo desta conta aos seus próprios dados ainda precisa ser configurado' },
]) {
  test(`${scenario.name} define senha e mantém acesso bloqueado até a etapa complementar`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    await invite(page, { name: scenario.person, email: scenario.email, role: scenario.role, ownOnly: scenario.ownOnly });
    await beginActivation(page);
    await page.getByRole('button', { name: 'Ativar minha conta', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sua senha foi definida', exact: true })).toBeVisible();
    await expect(page.getByText(scenario.guidance, { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sua conta está pronta', exact: true })).toHaveCount(0);
    await noOverflow(page);
    await page.getByRole('link', { name: 'Ir para o login', exact: true }).click();
    await page.getByLabel('E-mail', { exact: true }).fill(scenario.email);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(scenario.loginError);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Sair da plataforma', exact: true })).toHaveCount(0);
  });
}

test('código inválido em primeiro acesso explica o problema e mantém a rota pública utilizável', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/ativar-acesso');
  await expect(page.getByRole('heading', { name: 'Seu primeiro acesso', exact: true })).toBeVisible();
  const input = page.getByLabel('Código do convite', { exact: true });
  await input.fill('invite-inexistente-123');
  await page.getByRole('button', { name: 'Conferir convite', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Este convite de conta é inválido.');
  await expect(page.getByLabel('Nova senha', { exact: true })).toHaveCount(0);
  await expect(input).toHaveValue('invite-inexistente-123');
  await expect(page.getByRole('button', { name: 'Conferir convite', exact: true })).toBeEnabled();
  await noOverflow(page);
});
