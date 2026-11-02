import { expect, test, type Page } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

const inviteToken = 'tok-equipe-civil-2026';
const publicPath = `/team-invites/public/${inviteToken}/appointments`;

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function fillRequest(page: Page, location: string) {
  const tomorrow = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86_400_000)));
  await page.getByRole('checkbox', { name: /^Manutenção programada/ }).check();
  await page.getByRole('checkbox', { name: /^Inspeção de área/ }).check();
  await page.getByLabel('Local do atendimento *', { exact: true }).fill(location);
  await page.getByLabel('Início solicitado *', { exact: true }).fill(`${tomorrow}T10:00`);
  await page.getByLabel('Término solicitado *', { exact: true }).fill(`${tomorrow}T12:00`);
  await page.getByRole('checkbox', { name: 'Camila Demo', exact: true }).check();
  await page.getByLabel('Função de Camila Demo no atendimento', { exact: true }).fill('Executante');
  await page.getByLabel('Seu nome (autodeclarado) *', { exact: true }).fill('Solicitante de teste');
  await page.getByLabel('Observações da solicitação', { exact: true }).fill('Pedido sintético para conferir o fluxo por convite.');
  await page.getByRole('checkbox', { name: 'Entendo que a solicitação depende de confirmação e não autoriza a execução do serviço.', exact: true }).check();
  return tomorrow;
}

for (const width of [320, 390]) {
  test(`solicitação anônima por convite exige confirmação e responsável na agenda a ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/convite/${inviteToken}`);
    await expect(page.getByRole('heading', { name: 'Solicitar atendimento', exact: true })).toBeVisible();
    await expect(page.getByText(/o convite não comprova sua identidade/)).toBeVisible();
    await expect(page.getByText('Nenhuma solicitação realizada por este convite.', { exact: true })).toBeVisible();
    const tomorrow = await fillRequest(page, `Galpão convite E2E ${width}`);
    await noOverflow(page);
    await page.screenshot({ path: test.info().outputPath('convite-preenchido.png'), fullPage: true });
    await page.getByRole('button', { name: 'Revisar solicitação', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Confirmar solicitação de atendimento', exact: true });
    await expect(review).toBeVisible();
    await expect(review).toContainText('Manutenção programada + Inspeção de área');
    await expect(review).toContainText('O pedido ficará como solicitado.');
    await noOverflow(page);
    // Closing the review preserves the concrete request instead of silently sending it.
    await review.getByRole('button', { name: 'Voltar ao preenchimento', exact: true }).click();
    await expect(page.getByLabel('Local do atendimento *', { exact: true })).toHaveValue(`Galpão convite E2E ${width}`);
    await page.getByRole('button', { name: 'Revisar solicitação', exact: true }).click();
    await review.getByRole('button', { name: 'Enviar solicitação', exact: true }).click();
    await expect(review).toHaveCount(0);
    const requestCard = page.getByRole('article', { name: /^Solicitação AG-/ });
    await expect(requestCard).toHaveCount(1);
    await expect(requestCard).toContainText('Solicitado');
    await expect(requestCard).toContainText(`Galpão convite E2E ${width}`);
    await expect(requestCard).toContainText('Camila Demo (Executante)');
    const code = await requestCard.getByRole('heading', { level: 3 }).innerText();
    await expect(page.getByText(`Solicitação ${code} recebida. Aguarde a avaliação e a confirmação do responsável.`, { exact: true })).toBeVisible();
    const publicRows = await page.evaluate(async endpoint => {
      const response = await fetch(`/api/v1${endpoint}`);
      return { status: response.status, rows: await response.json() };
    }, publicPath);
    expect(publicRows.status).toBe(200);
    expect(publicRows.rows).toHaveLength(1);
    expect(publicRows.rows[0].status).toBe('REQUESTED');
    expect(publicRows.rows[0].requestedStartsAt).toBe(`${tomorrow}T13:00:00.000Z`);
    expect(publicRows.rows[0].requestedEndsAt).toBe(`${tomorrow}T15:00:00.000Z`);
    expect(publicRows.rows[0]).not.toHaveProperty('workerId');
    expect(JSON.stringify(publicRows.rows)).not.toMatch(/history|eligibility|permitId|workerId/);

    // SPA login keeps the current demonstration instance, including the public request.
    await page.getByRole('link', { name: 'Entrar com conta', exact: true }).click();
    await page.getByRole('button', { name: 'Ver demonstrações', exact: true }).click();
    await page.getByRole('button', { name: 'Gestor SESMT', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await navigateWithinApp(page, `/app/agenda?q=${encodeURIComponent(code)}&status=REQUESTED`);
    const internalRow = page.getByRole('row').filter({ hasText: code });
    await expect(internalRow).toHaveCount(1);
    await expect(internalRow).toContainText('Solicitado');
    await expect(internalRow).toContainText('A designar');
    await internalRow.getByRole('link', { name: 'Consultar atendimento', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dados do atendimento', exact: true })).toBeVisible();
    await expect(page.getByText('A designar', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Acompanhar PT →', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Abrir atendimento em campo', exact: true })).toHaveCount(0);
    await noOverflow(page);
    await page.getByRole('button', { name: 'Confirmar agendamento', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Confirmar agendamento', exact: true });
    const responsible = confirmation.getByLabel('Responsável pelo atendimento *', { exact: true });
    await expect(responsible).toHaveValue('');
    await responsible.selectOption({ label: 'Diego Demo · técnico' });
    await confirmation.getByLabel('Início confirmado *', { exact: true }).fill(`${tomorrow}T10:30`);
    await confirmation.getByLabel('Término confirmado *', { exact: true }).fill(`${tomorrow}T12:30`);
    await noOverflow(page);
    await confirmation.getByRole('button', { name: 'Confirmar agendamento', exact: true }).click();
    await expect(page.getByText('Agendamento confirmado.', { exact: true })).toBeVisible();
    await expect(page.getByText('Diego Demo · técnico', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Acompanhar PT →', exact: true })).toHaveCount(0);
    await expect(page.getByText('Horário solicitado pela equipe').locator('..')).toContainText('10:00');
    await expect(page.getByText('Horário operacional confirmado').locator('..')).toContainText('10:30');

    await navigateWithinApp(page, `/convite/${inviteToken}`);
    await expect(page.getByRole('article', { name: `Solicitação ${code}`, exact: true })).toContainText('Confirmado');
    await expect(page.getByRole('article', { name: `Solicitação ${code}`, exact: true })).toContainText('Horário confirmado:');
    await expect(page.getByRole('article', { name: `Solicitação ${code}`, exact: true })).toContainText('10:30');
    const otherToken = await page.evaluate(async () => {
      const clientUrl = '/src/shared/api/client.ts';
      const { api } = await import(clientUrl);
      const invite = await api.post('/team-invites', { teamId: '00000000-0000-4000-8000-000000000200', validityHours: 24 });
      return invite.token;
    });
    await navigateWithinApp(page, `/convite/${otherToken}`);
    await expect(page.getByText('Nenhuma solicitação realizada por este convite.', { exact: true })).toBeVisible();
    await expect(page.getByRole('article', { name: `Solicitação ${code}`, exact: true })).toHaveCount(0);
    await noOverflow(page);
    expect(errors).toEqual([]);
  });
}

test('convites expirados e revogados não expõem formulários nem permitem solicitar ou operar atendimento', async ({ page }) => {
  for (const [token, label] of [['tok-equipe-expirada', 'Expirado'], ['tok-equipe-revogada', 'Revogado']]) {
    await page.goto(`/convite/${token}`);
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Solicitar atendimento', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Solicitações deste convite', exact: true })).toHaveCount(0);
    const rejected = await page.evaluate(async value => {
      const endpoint = `/api/v1/team-invites/public/${value}/appointments`;
      const reading = await fetch(endpoint);
      const sending = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ acknowledged: true }) });
      return [reading.status, sending.status];
    }, token);
    expect(rejected).toEqual([410, 410]);
  }
});

test('atualização da equipe permite retirar participante indisponível sem perder o pedido preenchido', async ({ page }) => {
  await loginDemo(page); await navigateWithinApp(page, `/convite/${inviteToken}`);
  await fillRequest(page, 'Local preservado após mudança da equipe');
  await page.evaluate(async () => {
    const clientUrl = '/src/shared/api/client.ts'; const { api } = await import(clientUrl);
    const teamPath = '/teams/00000000-0000-4000-8000-000000000200'; const team = await api.get(teamPath);
    const members = team.members.filter((member: { workerId: string }) => member.workerId !== '00000000-0000-4000-8000-000000000040').map((member: { workerId: string; serviceFunction: string }) => ({ workerId: member.workerId, serviceFunction: member.serviceFunction }));
    await api.patch(teamPath, { name: team.name, unitId: team.unitId, chiefId: team.chiefId, members }, { etag: `"${team.revision}"` });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('heading', { name: 'Participantes vinculados (2)', exact: true })).toBeVisible();
  await expect(page.getByText(/Seu preenchimento contém 1 participante\(s\) e 0 serviço\(s\) indisponível/)).toBeVisible();
  await page.getByRole('button', { name: 'Remover itens indisponíveis', exact: true }).click();
  await expect(page.getByLabel('Local do atendimento *', { exact: true })).toHaveValue('Local preservado após mudança da equipe');
  await expect(page.getByLabel('Seu nome (autodeclarado) *', { exact: true })).toHaveValue('Solicitante de teste');
  await expect(page.getByRole('checkbox', { name: /^Manutenção programada/ })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Bruno Demo', exact: true }).check();
  await page.getByRole('button', { name: 'Revisar solicitação', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Enviar solicitação', exact: true }).click();
  const receipt = page.getByRole('article', { name: /^Solicitação AG-/ });
  await expect(receipt).toContainText('Bruno Demo'); await expect(receipt).not.toContainText('Camila Demo');
});

test('revogação antes do envio preserva o limite do convite e impede criação de pedido', async ({ page }) => {
  await loginDemo(page);
  await navigateWithinApp(page, `/convite/${inviteToken}`);
  await fillRequest(page, 'Galpão convite revogado');
  await page.getByRole('button', { name: 'Revisar solicitação', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Confirmar solicitação de atendimento', exact: true });
  await expect(review).toBeVisible();
  await page.evaluate(async () => {
    const clientUrl = '/src/shared/api/client.ts';
    const { api } = await import(clientUrl);
    await api.post('/team-invites/invite-demo-active/revoke', {});
  });
  await review.getByRole('button', { name: 'Enviar solicitação', exact: true }).click();
  await expect(page.getByText('Revogado', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Solicitar atendimento', exact: true })).toHaveCount(0);
  await expect(page.getByRole('article', { name: /^Solicitação AG-/ })).toHaveCount(0);
  await navigateWithinApp(page, '/app/agenda?q=Galp%C3%A3o%20convite%20revogado');
  await expect(page.getByRole('heading', { name: /Nenhum atendimento/ })).toBeVisible();
});

