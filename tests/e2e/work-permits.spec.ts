import { expect, test, type Page } from '@playwright/test';
import { loginDemo, logout, navigateWithinApp, simplePdf } from './helpers';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function openAppointment(page: Page, n: number) {
  await navigateWithinApp(page, `/app/agenda/${id(n)}`);
  await page.getByRole('button', { name: 'Abrir atendimento em campo', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Abrir atendimento em campo', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/pts\//);
  await expect(page.getByRole('heading', { name: 'Conferência do atendimento' })).toBeVisible();
  return new URL(page.url()).pathname;
}
async function checklist(page: Page) {
  const preparation = page.getByRole('region', { name: 'Preparação do modelo PT', exact: true }).first();
  if (await preparation.count() && await preparation.getByRole('button', { name: 'Salvar preparação da PT' }).count()) {
    await preparation.getByLabel('Fornecedor de serviço', { exact: true }).fill('Fornecedor Demo');
    await preparation.getByLabel('Frente de serviço', { exact: true }).fill('Frente de apoio Demo');
    await preparation.getByLabel('Atividade a ser realizada', { exact: true }).fill('Inspeção fictícia dos controles na frente de apoio.');
    await preparation.getByLabel('Referência da análise de risco / APT', { exact: true }).fill('AR-DEMO-1');
    await preparation.getByRole('checkbox', { name: 'Trabalho sobreposto', exact: true }).check();
    for (const radio of await preparation.getByRole('radio', { name: 'Sim', exact: true }).all()) await radio.check();
    await preparation.getByRole('button', { name: 'Salvar preparação da PT', exact: true }).click();
    await expect(preparation.getByText('Preparação sincronizada com esta versão.', { exact: true })).toBeVisible();
  }
  const radios = page.locator('#conferencia').getByRole('radio', { name: 'Sim', exact: true });
  for (const radio of await radios.all()) await radio.check();
  await page.getByRole('button', { name: 'Salvar checklist', exact: true }).click();
  await expect(page.getByText('Respostas sincronizadas com esta versão.', { exact: true })).toBeVisible();
}
async function science(page: Page, name: string, draw = false) {
  await page.getByRole('button', { name: `Registrar ciência de ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  if (draw) {
    await dialog.getByRole('radio', { name: 'Desenho', exact: true }).check();
    const surface = dialog.getByLabel('Área para desenhar a manifestação');
    const bounds = await surface.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + 25, bounds!.y + 40);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 80, bounds!.y + 70, { steps: 8 });
    await page.mouse.move(bounds!.x + 140, bounds!.y + 35, { steps: 8 });
    await page.mouse.up();
    await expect(dialog.getByText('Desenho registrado. Você pode refazer antes de confirmar.', { exact: true })).toBeVisible();
  }
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar ação', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Registrar ciência de ${name}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole('main').locator('[aria-busy="true"]')).toHaveCount(0);
}
async function confirm(page: Page, button: string) {
  await page.getByRole('button', { name: button, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar ação', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function switchRole(page: Page, role: 'Engenheiro' | 'Técnico de segurança') {
  await logout(page);
  await page.getByRole('button', { name: role, exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}

test('pendência de Bruno permanece após upload e abertura não libera a execução', async ({ page }) => {
  await loginDemo(page, 'Técnico de segurança');
  const pathname = await openAppointment(page, 220);
  await expect(page.getByText('Em verificação', { exact: true }).first()).toBeVisible();
  await checklist(page);
  await science(page, 'Camila Demo');
  await science(page, 'Bruno Demo');
  await expect(page.getByText('Existem requisitos documentais pendentes para este serviço.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Liberar execução', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Registrar início da execução', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Consultar pendências e evidências', exact: true }).click();
  const person = page.getByRole('region', { name: 'Elegibilidade documental dos participantes' }).locator('article').filter({ hasText: 'Bruno Demo' });
  await person.getByRole('button', { name: 'Substituir evidência', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Arquivo da evidência *', { exact: true }).setInputFiles(simplePdf('Evidência fictícia para Bruno'));
  await dialog.getByLabel(/^Data inicial da evidência/).fill('2026-01-01');
  await dialog.getByLabel(/^Data final da evidência/).fill('2030-12-31');
  await dialog.getByRole('button', { name: 'Enviar para conferência', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(person.getByText('Aguardando conferência', { exact: true })).toBeVisible();
  await navigateWithinApp(page, pathname);
  await expect(page.getByText('Existem requisitos documentais pendentes para este serviço.', { exact: true })).toBeVisible();
});

test('PT no celular percorre checklist, desenho, liberação, execução e aprovação explícita', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginDemo(page, 'Técnico de segurança');
  const pathname = await openAppointment(page, 221);
  await checklist(page);
  await science(page, 'Camila Demo', true);
  await confirm(page, 'Liberar execução');
  await expect(page.getByText('Execução liberada', { exact: true }).first()).toBeVisible();
  await confirm(page, 'Registrar início da execução');
  await expect(page.getByText('Em execução', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Resumo do atendimento', { exact: true }).fill('Atendimento fictício concluído com os registros conferidos pela equipe.');
  const closing = page.getByLabel('Checklist de encerramento do modelo', { exact: true });
  for (const radio of await closing.getByRole('radio', { name: 'Sim', exact: true }).all()) await radio.check();
  await confirm(page, 'Concluir atividade e enviar para revisão');
  await expect(page.getByText('Atividade concluída', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Aguardando revisão', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await switchRole(page, 'Engenheiro');
  await navigateWithinApp(page, pathname);
  await page.getByRole('button', { name: 'Revisar encerramento da versão 1', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirmar aprovação', exact: true }).click();
  await expect(dialog.getByText('Confirme sua decisão sobre esta versão.', { exact: true })).toBeVisible();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar aprovação', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Encerramento validado', { exact: true }).first()).toBeVisible();
  await page.getByText('Versão 1 · versão atual', { exact: true }).click();
  await expect(page.getByText('Aprovação do encerramento', { exact: true })).toBeVisible();
  await expect(page.locator('details[open]').getByText('Marina Demo', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('devolução cria versão documental preservando o encerramento e a versão anterior', async ({ page }) => {
  await loginDemo(page, 'Engenheiro');
  const pathname = `/app/pts/${id(230)}`;
  await navigateWithinApp(page, pathname);
  await page.getByRole('button', { name: 'Revisar encerramento da versão 1', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Decisão da revisão').selectOption('RETURN');
  await dialog.getByLabel('Motivo da devolução').fill('Detalhar o resultado registrado no encerramento fictício.');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar devolução', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Revisão devolvida', { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Resumo do atendimento', { exact: true })).toHaveCount(0);
  await switchRole(page, 'Técnico de segurança');
  await navigateWithinApp(page, pathname);
  await page.getByRole('button', { name: 'Criar versão de correção', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motivo da correção').fill('Complementar a descrição sem reabrir a execução.');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar ação', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Atividade concluída', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar início da execução', exact: true })).toHaveCount(0);
  await expect(page.getByText('Versão 1', { exact: true })).toBeVisible();
  await science(page, 'Camila Demo');
  await page.getByLabel('Resumo do atendimento', { exact: true }).fill('Resultado fictício complementado na segunda versão documental para revisão.');
  await confirm(page, 'Reapresentar correção para revisão');
  await expect(page.getByText('Versão 2 · versão atual', { exact: true })).toBeVisible();
  await page.getByText('Versão 1', { exact: true }).click();
  await expect(page.getByText('Exemplo sintético concluído para demonstrar a fila de revisão do engenheiro.', { exact: true })).toBeVisible();
});

test('agendamento valida período e registra função do participante, auditor permanece em consulta', async ({ page }) => {
  await loginDemo(page, 'Engenheiro');
  await page.getByRole('link', { name: 'Agendar serviço', exact: true }).click();
  await page.getByLabel('Equipe *', { exact: true }).selectOption(id(200));
  await page.getByRole('checkbox', { name: 'Manutenção programada', exact: true }).check();
  await page.getByLabel('Local do serviço *', { exact: true }).fill('Área fictícia de teste');
  await page.getByLabel('Responsável pelo atendimento *', { exact: true }).selectOption(id(25));
  await page.getByLabel('Início previsto *', { exact: true }).fill('2026-11-10T10:00');
  await page.getByLabel('Término previsto *', { exact: true }).fill('2026-11-10T09:00');
  await page.getByRole('checkbox', { name: 'Camila Demo', exact: true }).check();
  await page.getByLabel('Função de Camila Demo neste serviço', { exact: true }).fill('Executante');
  await page.getByRole('button', { name: 'Salvar agendamento', exact: true }).click();
  await expect(page.getByText('O término deve ocorrer depois do início.', { exact: true })).toBeVisible();
  await page.getByLabel('Término previsto *', { exact: true }).fill('2026-11-10T11:00');
  await page.getByRole('button', { name: 'Salvar agendamento', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/agenda\/[a-z0-9-]+$/);
  await expect(page.getByText('Área fictícia de teste', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Elegibilidade documental dos participantes' }).getByText('Função neste serviço: Executante', { exact: true })).toBeVisible();
  await logout(page);
  await page.getByRole('button', { name: 'Auditor', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await navigateWithinApp(page, '/app/agenda/novo');
  await expect(page.getByRole('heading', { name: 'Esta área precisa de autorização.' })).toBeVisible();
});
