import { expect, test, type Page } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const width of [1280, 390]) {
  test(`concessão por empresa/unidade/equipe e desativação confirmada a ${width}px`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 });
    // This helper completes the administrator's MFA challenge before navigation.
    await loginDemo(page, 'Administrador');
    await navigateWithinApp(page, '/app/configuracoes/usuarios');
    await page.getByRole('button', { name: 'Convidar usuário', exact: true }).click();
    const invitation = page.getByRole('dialog', { name: 'Convidar usuário', exact: true });
    const name = `Pessoa de teste de escopo ${width}px`;
    const email = `escopo-${width}@example.invalid`;
    await invitation.getByLabel('Nome', { exact: true }).fill(name);
    await invitation.getByLabel('E-mail', { exact: true }).fill(email);
    await invitation.getByLabel('Recursos Humanos', { exact: true }).check();
    await invitation.getByLabel('Organização Exemplo', { exact: true }).check();
    await invitation.getByLabel('Unidade Matriz', { exact: true }).check();
    await invitation.getByLabel('Equipe de manutenção · demonstração', { exact: true }).check();
    await page.screenshot({ path: test.info().outputPath('escopo-selecionado.png'), fullPage: true });
    await expect(invitation.getByLabel('Unidade Operacional', { exact: true })).not.toBeChecked();
    await expect(invitation.getByLabel('Equipe operacional · demonstração', { exact: true })).toHaveCount(0);
    await expectNoOverflow(page);

    const sent = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/users');
    await invitation.getByRole('button', { name: 'Enviar convite', exact: true }).click();
    expect((await sent).postDataJSON()).toMatchObject({
      displayName: name, email, roles: ['HR'],
      scope: { companyIds: [id(1)], unitIds: [id(2)], teamIds: [id(200)], ownOnly: false },
    });
    await expect(invitation).toHaveCount(0);
    await expect(page.getByText('Convite confirmado pela API.', { exact: true })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: email });
    await expect(row).toContainText('Convidado');
    await row.getByRole('button', { name: 'Alterar acesso', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Alterar acesso', exact: true });
    await expect(editor.getByLabel('Organização Exemplo', { exact: true })).toBeChecked();
    await expect(editor.getByLabel('Unidade Matriz', { exact: true })).toBeChecked();
    await expect(editor.getByLabel('Unidade Operacional', { exact: true })).not.toBeChecked();
    await expect(editor.getByLabel('Equipe de manutenção · demonstração', { exact: true })).toBeChecked();
    await expect(editor.getByLabel('Situação', { exact: true })).toHaveValue('INVITED');

    const accessRequests: unknown[] = [];
    page.on('request', request => {
      if (request.method() === 'PATCH' && /\/api\/v1\/users\/[^/]+\/access$/.test(new URL(request.url()).pathname)) accessRequests.push(request.postDataJSON());
    });
    await editor.getByLabel('Situação', { exact: true }).selectOption('DISABLED');
    await editor.getByRole('button', { name: 'Salvar acesso', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Confirmar desativação do acesso', exact: true });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(`${name} · ${email}`);
    await expect(confirmation).toContainText('Organização Exemplo');
    await expect(confirmation).toContainText('Unidade Matriz');
    await expect(confirmation).toContainText('Equipe de manutenção · demonstração');
    await expect(confirmation.getByText('1', { exact: true })).toBeVisible();
    expect(accessRequests).toEqual([]);
    await confirmation.getByRole('button', { name: 'Voltar à edição', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(editor.getByLabel('Situação', { exact: true })).toHaveValue('DISABLED');
    await expect(row).toContainText('Convidado');
    expect(accessRequests).toEqual([]);

    await editor.getByRole('button', { name: 'Salvar acesso', exact: true }).click();
    await expect(confirmation).toBeVisible();
    await expectNoOverflow(page);
    await confirmation.getByRole('button', { name: 'Confirmar desativação', exact: true }).click();
    await expect(confirmation).toHaveCount(0); await expect(editor).toHaveCount(0);
    await expect(page.getByText('Acesso atualizado pela API.', { exact: true })).toBeVisible();
    await expect(row).toContainText('Desabilitado');
    expect(accessRequests).toHaveLength(1);
    expect(accessRequests[0]).toMatchObject({ status: 'DISABLED', scope: { companyIds: [id(1)], unitIds: [id(2)], teamIds: [id(200)] } });
    await expectNoOverflow(page); expect(errors).toEqual([]);
  });
}
