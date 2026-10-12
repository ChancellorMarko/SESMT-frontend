import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

test('gestor cadastra, pesquisa e altera equipe com participantes ativos e chefe', async ({ page }) => {
  await loginDemo(page);
  await page.getByRole('link', { name: 'Equipes', exact: true }).click();
  await page.getByRole('link', { name: 'Nova equipe', exact: true }).click();
  await page.getByLabel('Nome da equipe *', { exact: true }).fill('Equipe sintética E2E');
  await expect(page.getByLabel('Trabalhador 1 *', { exact: true }).getByRole('option', { name: 'Sofia Demo', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Trabalhador 1 *', { exact: true }).getByRole('option', { name: 'Luiza Demo', exact: true })).toHaveCount(0);
  await page.getByLabel('Trabalhador 1 *', { exact: true }).selectOption({ label: 'Camila Demo' });
  await page.getByRole('button', { name: 'Adicionar participante', exact: true }).click();
  await page.getByLabel('Trabalhador 2 *', { exact: true }).selectOption({ label: 'Bruno Demo' });
  await page.getByLabel('Função do participante 2 *', { exact: true }).fill('Apoio');
  await page.getByLabel('Chefe da equipe *', { exact: true }).selectOption({ label: 'Bruno Demo' });
  await page.getByRole('button', { name: 'Salvar equipe', exact: true }).click();
  await expect(page.getByText('Equipe cadastrada.', { exact: true })).toBeVisible();
  await page.getByLabel('Buscar equipes', { exact: true }).fill('sintetica e2e');
  const team = page.getByRole('article', { name: 'Equipe sintética E2E', exact: true });
  await expect(team).toContainText('Bruno Demo');
  await expect(team).toContainText('Chefe da equipe');
  await team.getByRole('link', { name: 'Editar equipe Equipe sintética E2E', exact: true }).click();
  await page.getByLabel('Nome da equipe *', { exact: true }).fill('Equipe sintética E2E revisada');
  await page.getByRole('button', { name: 'Remover participante 1', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar equipe', exact: true }).click();
  await expect(page.getByText('Equipe atualizada.', { exact: true })).toBeVisible();
  const updated = page.getByRole('article', { name: 'Equipe sintética E2E revisada', exact: true });
  await expect(updated).toContainText('1 participante(s)');
  await expect(updated).toContainText('Revisão 2');
  await expect(updated).not.toContainText('Camila Demo');
});

test('duplicidade e conflito de revisão preservam preenchimento e exigem conferência', async ({ page }) => {
  await loginDemo(page);
  await page.getByRole('link', { name: 'Equipes', exact: true }).click();
  await page.getByRole('link', { name: 'Nova equipe', exact: true }).click();
  await page.getByLabel('Nome da equipe *', { exact: true }).fill('Equipe de manutenção · demonstração');
  await page.getByLabel('Trabalhador 1 *', { exact: true }).selectOption({ label: 'Camila Demo' });
  await page.getByRole('button', { name: 'Salvar equipe', exact: true }).click();
  await expect(page.getByLabel('Nome da equipe *', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Nome da equipe *', { exact: true })).toHaveValue('Equipe de manutenção · demonstração');
  await page.getByRole('link', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Descartar e sair', exact: true }).click();
  await page.getByRole('link', { name: 'Editar equipe Equipe de manutenção · demonstração', exact: true }).click();
  await page.getByLabel('Nome da equipe *', { exact: true }).fill('Meu preenchimento preservado');
  // Simulates a concurrent API write after the editor has loaded revision 1.
  await page.evaluate(async () => {
    const clientModuleUrl = '/src/shared/api/client.ts';
    const { api, revisionEtag } = await import(clientModuleUrl);
    const teamId = window.location.pathname.split('/')[3];
    const current = await api.get(`/teams/${teamId}`);
    await api.patch(`/teams/${teamId}`, { name: 'Composição concorrente', unitId: current.unitId, chiefId: current.chiefId, members: current.members.map((member: { workerId: string; serviceFunction: string }) => ({ workerId: member.workerId, serviceFunction: member.serviceFunction })) }, { etag: revisionEtag(current.revision) });
  });
  await page.getByRole('button', { name: 'Salvar equipe', exact: true }).click();
  await expect(page.getByLabel('Nome da equipe *', { exact: true })).toHaveValue('Meu preenchimento preservado');
  await expect(page.getByRole('button', { name: 'Salvar equipe', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Conferir versão atual', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Versão atual da equipe', exact: true })).toContainText('Composição concorrente');
  await page.getByRole('button', { name: 'Usar revisão atual e manter meu preenchimento', exact: true }).click();
  await expect(page.getByLabel('Nome da equipe *', { exact: true })).toHaveValue('Meu preenchimento preservado');
  await page.getByRole('button', { name: 'Salvar equipe', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Meu preenchimento preservado', exact: true })).toContainText('Revisão 3');
});

test('perfil operacional consulta e pesquisa equipes sem cadastro ou edição', async ({ page }) => {
  await loginDemo(page, 'Técnico de segurança');
  await page.getByRole('link', { name: 'Equipes', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Nova equipe', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Editar equipe/ })).toHaveCount(0);
  await page.getByLabel('Buscar equipes', { exact: true }).fill('julia');
  await expect(page.getByRole('article', { name: 'Equipe de manutenção · demonstração', exact: true })).toBeVisible();
  await navigateWithinApp(page, '/app/equipes/novo');
  await expect(page.getByRole('heading', { name: 'Esta área precisa de autorização.', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar equipe', exact: true })).toHaveCount(0);
});
