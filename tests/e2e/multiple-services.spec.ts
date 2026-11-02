import { expect, test, type Page } from '@playwright/test';
import { loginDemo, logout, navigateWithinApp } from './helpers';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const originalHotQuestion = 'Contexto de trabalho a quente conferido (demonstração)';
const revisedHotQuestion = 'Contexto e orientação adicional a quente conferidos no novo template (demo)';

async function switchRole(page: Page, role: 'Engenheiro' | 'Técnico de segurança') {
  await logout(page);
  // Stay in this document: a full reload deliberately clears the demo records.
  await page.getByRole('button', { name: role, exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}

async function scheduleAndConfirm(page: Page, location: string) {
  const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await navigateWithinApp(page, '/app/agenda/novo');
  await page.getByLabel('Equipe *', { exact: true }).selectOption(id(200));
  await page.getByRole('checkbox', { name: 'Trabalho a quente', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Espaço confinado', exact: true }).check();
  await page.getByLabel('Local do serviço *', { exact: true }).fill(location);
  await page.getByLabel('Responsável pelo atendimento *', { exact: true }).selectOption(id(25));
  await page.getByLabel('Início previsto *', { exact: true }).fill(`${day}T10:00`);
  await page.getByLabel('Término previsto *', { exact: true }).fill(`${day}T11:00`);
  await page.getByRole('checkbox', { name: 'Camila Demo', exact: true }).check();
  await page.getByLabel('Função de Camila Demo neste serviço', { exact: true }).fill('Executante');
  await page.getByRole('button', { name: 'Salvar agendamento', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/agenda\/[0-9a-f]{8}-[0-9a-f-]{27}$/);
  const eligibility = page.getByRole('region', { name: 'Elegibilidade documental dos participantes' });
  await expect(eligibility.getByRole('heading', { name: 'Trabalho a quente · evidência administrativa (demo)', exact: true })).toBeVisible();
  await expect(eligibility.getByRole('heading', { name: 'Espaço confinado · evidência administrativa (demo)', exact: true })).toBeVisible();
  await expect(eligibility.locator('h4')).toHaveCount(2);
  await page.getByRole('button', { name: 'Confirmar agendamento', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar agendamento', exact: true }).click();
  await expect(page.getByText('Agendamento confirmado.', { exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}

async function openPermit(page: Page, appointmentPath: string) {
  await navigateWithinApp(page, appointmentPath);
  await page.getByRole('button', { name: 'Abrir atendimento em campo', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Abrir atendimento em campo', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/pts\/[a-z0-9-]+$/);
  await expect(page.getByRole('heading', { name: 'Conferência do atendimento', exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}

test('atendimento com dois serviços reúne requisitos, fixa categorias e preserva templates após nova publicação', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginDemo(page, 'Engenheiro');
  const appointmentPath = await scheduleAndConfirm(page, 'Área Demo de serviços múltiplos');
  await switchRole(page, 'Técnico de segurança');
  const permitPath = await openPermit(page, appointmentPath);
  const checklist = page.locator('#conferencia');
  await expect(checklist.getByRole('group')).toHaveCount(4);
  await expect(checklist.getByRole('group', { name: new RegExp(originalHotQuestion.replace(/[()]/g, '\\$&')) })).toBeVisible();
  await expect(checklist.getByRole('group', { name: /Contexto de espaço confinado conferido/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Requisitos por participante', exact: true }).getByText('Trabalho a quente · evidência administrativa (demo)', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Requisitos por participante', exact: true }).getByText('Espaço confinado · evidência administrativa (demo)', { exact: true })).toBeVisible();
  const preparation = page.getByRole('region', { name: 'Preparação do modelo PT', exact: true });
  const categories = preparation.getByRole('group', { name: 'Categorias aplicáveis ao serviço', exact: true });
  for (const name of [/Trabalho a quente/, /Espaço confinado/]) {
    await expect(categories.getByRole('checkbox', { name })).toBeChecked();
    await expect(categories.getByRole('checkbox', { name })).toBeDisabled();
  }
  await expect(categories.getByRole('checkbox', { name: /Trabalho em altura/ })).not.toBeChecked();
  await expect(categories.getByRole('checkbox', { name: /Trabalho em altura/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Liberar execução', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await switchRole(page, 'Engenheiro');
  await navigateWithinApp(page, '/app/configuracoes/servicos');
  await page.getByRole('navigation', { name: 'Selecionar serviço', exact: true }).getByRole('button', { name: /Trabalho a quente/ }).click();
  await page.getByLabel('Texto da pergunta 1 *', { exact: true }).fill(revisedHotQuestion);
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await expect(page.getByText('Rascunho salvo. O template publicado e as PTs abertas permanecem preservados.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publicar rascunho salvo', exact: true }).click();
  const publication = page.getByRole('dialog', { name: 'Publicar template do serviço', exact: true });
  await publication.getByLabel('Motivo da publicação *', { exact: true }).fill('Atualizar a pergunta demonstrativa para novos atendimentos sem alterar registros abertos.');
  await publication.getByRole('checkbox').check();
  await publication.getByRole('button', { name: 'Confirmar publicação', exact: true }).click();
  await expect(publication).toHaveCount(0);
  await expect(page.getByText('Template publicado. Novas PTs usarão esta versão; as perguntas das PTs já abertas permanecem preservadas.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await navigateWithinApp(page, permitPath);
  await expect(page.locator('#conferencia').getByRole('group', { name: new RegExp(originalHotQuestion.replace(/[()]/g, '\\$&')) })).toBeVisible();
  await expect(page.locator('#conferencia').getByText(revisedHotQuestion, { exact: false })).toHaveCount(0);
  await expect(page.getByText('Template vDEMO-SERVICO-511-1', { exact: true })).toBeVisible();
  const nextAppointment = await scheduleAndConfirm(page, 'Área Demo de serviços múltiplos após publicação');
  await switchRole(page, 'Técnico de segurança');
  await openPermit(page, nextAppointment);
  await expect(page.locator('#conferencia').getByRole('group', { name: new RegExp(revisedHotQuestion.replace(/[()]/g, '\\$&')) })).toBeVisible();
  await expect(page.getByText('Template vDEMO-SERVICO-511-1-R2', { exact: true })).toBeVisible();
  await expect(page.getByText('Template vDEMO-SERVICO-513-1', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
