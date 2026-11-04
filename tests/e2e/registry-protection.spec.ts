import { expect, test, type Page } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const width of [320, 390]) {
  test(`cadastro de equipe a ${width}px preserva composição e resolve conflito após comparação`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 }); await loginDemo(page);
    await navigateWithinApp(page, '/app/equipes');
    await page.getByRole('link', { name: 'Nova equipe', exact: true }).click();
    const name = `Equipe de teste ${width}px`;
    await page.getByLabel('Nome da equipe *', { exact: true }).fill(name);
    await page.getByLabel('Trabalhador 1 *', { exact: true }).selectOption(id(40));
    await expect(page.getByLabel('Chefe da equipe *', { exact: true })).toHaveValue(id(40));
    await page.getByRole('button', { name: 'Adicionar participante', exact: true }).click();
    await expect(page.getByLabel('Trabalhador 2 *', { exact: true }).locator(`option[value="${id(40)}"]`)).toHaveCount(0);
    await page.getByLabel('Trabalhador 2 *', { exact: true }).selectOption(id(41));
    await page.getByLabel('Função do participante 2 *', { exact: true }).fill('Apoio');
    await expectNoOverflow(page);
    await page.getByRole('link', { name: 'Voltar às equipes', exact: true }).click();
    const discard = page.getByRole('dialog', { name: 'Alterações não salvas', exact: true });
    await expect(discard).toBeVisible(); await discard.getByRole('button', { name: 'Continuar preenchendo', exact: true }).click();
    await expect(page.getByLabel('Nome da equipe *', { exact: true })).toHaveValue(name);
    await expect(page.getByLabel('Trabalhador 2 *', { exact: true })).toHaveValue(id(41));
    await page.getByRole('button', { name: 'Salvar equipe', exact: true }).click();
    await expect(page.getByText('Equipe cadastrada.', { exact: true })).toBeVisible();
    const card = page.getByRole('article', { name, exact: true });
    await expect(card).toContainText('Camila Demo'); await expect(card).toContainText('Bruno Demo');
    const edit = card.getByRole('link', { name: `Editar equipe ${name}`, exact: true });
    const teamId = (await edit.getAttribute('href'))!.split('/')[3]; await edit.click();
    await page.getByLabel('Nome da equipe *', { exact: true }).fill(`${name} revisada`);
    // A second operator changes the real demo record through the same API.
    await page.evaluate(async ({ teamId, name }) => {
      const clientUrl = '/src/shared/api/client.ts'; const { api } = await import(clientUrl);
      const current = await api.get(`/teams/${teamId}`);
      await api.patch(`/teams/${teamId}`, { name: `${name} concorrente`, unitId: current.unitId, chiefId: current.chiefId, members: current.members.slice(0, 1).map((member: { workerId: string; serviceFunction: string }) => ({ workerId: member.workerId, serviceFunction: member.serviceFunction })) }, { etag: `"${current.revision}"` });
    }, { teamId, name });
    await page.getByRole('button', { name: 'Salvar equipe', exact: true }).click();
    await expect(page.getByText(/Esta equipe mudou desde que o formulário foi aberto/)).toBeVisible();
    await expect(page.getByLabel('Nome da equipe *', { exact: true })).toHaveValue(`${name} revisada`);
    await expect(page.getByLabel('Trabalhador 2 *', { exact: true })).toHaveValue(id(41));
    await expect(page.getByRole('button', { name: 'Salvar equipe', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Conferir versão atual', exact: true }).click();
    await expect(page.getByText('Cadastro atual · revisão 2', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Versão atual da equipe', exact: true })).toContainText(`${name} concorrente`);
    await page.getByRole('button', { name: 'Usar revisão atual e manter meu preenchimento', exact: true }).click();
    await page.getByRole('button', { name: 'Salvar equipe', exact: true }).click();
    await expect(page.getByText('Equipe atualizada.', { exact: true })).toBeVisible();
    const updated = page.getByRole('article', { name: `${name} revisada`, exact: true });
    await expect(updated).toContainText('Camila Demo'); await expect(updated).toContainText('Bruno Demo');
    await expectNoOverflow(page); expect(errors).toEqual([]);
  });
}

test.describe('concessão administrativa com navegador no fuso de Tóquio', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });
  for (const width of [320, 390]) {
    test(`editor de acesso a ${width}px preserva alterações e usa horário de São Paulo`, async ({ page }) => {
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width, height: 844 }); await loginDemo(page, 'Administrador');
      await navigateWithinApp(page, '/app/configuracoes/usuarios');
      const row = page.getByRole('row').filter({ hasText: 'Ana Demo' });
      await row.getByRole('button', { name: 'Alterar acesso', exact: true }).click();
      const editor = page.getByRole('dialog', { name: 'Alterar acesso', exact: true });
      const deadline = editor.getByLabel('Concessão válida até (São Paulo)', { exact: true });
      await deadline.fill('2030-11-20T08:15');
      page.once('dialog', dialog => dialog.dismiss()); await page.keyboard.press('Escape');
      await expect(editor).toBeVisible(); await expect(deadline).toHaveValue('2030-11-20T08:15');
      await expectNoOverflow(page);
      const sent = page.waitForRequest(request => request.method() === 'PATCH' && request.url().includes(`/users/${id(22)}/access`));
      await editor.getByRole('button', { name: 'Salvar acesso', exact: true }).click();
      expect((await sent).postDataJSON().scope.expiresAt).toBe('2030-11-20T11:15:00.000Z');
      await expect(editor).toHaveCount(0); await expect(page.getByText('Acesso atualizado pela API.', { exact: true })).toBeVisible();
      await row.getByRole('button', { name: 'Alterar acesso', exact: true }).click();
      await expect(deadline).toHaveValue('2030-11-20T08:15');
      await page.keyboard.press('Escape'); await expect(editor).toHaveCount(0);
      await expectNoOverflow(page); expect(errors).toEqual([]);
    });
  }
});
