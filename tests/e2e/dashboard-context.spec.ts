import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

const unitA = '00000000-0000-4000-8000-000000000002';
const unitB = '00000000-0000-4000-8000-000000000003';

test('trocar a unidade do painel não reaplica a equipe anterior nas consultas e nos atalhos', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page, 'Engenheiro');
  const requests: URL[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/v1/permit-dashboard') requests.push(url);
  });
  const team = page.getByRole('combobox', { name: 'Equipe operacional', exact: true });
  await expect(team).toBeVisible();
  await page.getByLabel('Período de início', { exact: true }).fill('2026-10-01');
  await page.getByLabel('Período até', { exact: true }).fill('2026-11-30');
  await team.selectOption({ index: 1 });
  const selectedTeam = await team.inputValue();
  expect(selectedTeam).toBeTruthy();
  await expect.poll(() => requests.at(-1)?.searchParams.get('teamId')).toBe(selectedTeam);

  await page.getByRole('combobox', { name: 'Unidade de trabalho', exact: true }).selectOption(unitB);
  await expect.poll(() => requests.some(url => url.searchParams.get('unitId') === unitB)).toBe(true);
  expect(requests.filter(url => url.searchParams.get('unitId') === unitB).every(url => !url.searchParams.has('teamId'))).toBe(true);
  // The application layout remounts protected pages when the unit changes.
  await expect(page.getByLabel('Período de início', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Período até', { exact: true })).toHaveValue('');
  const permits = page.getByRole('link', { name: /Permissões em atendimento/ });
  await expect(permits).toBeVisible();
  const permitLink = new URL((await permits.getAttribute('href'))!, page.url());
  expect(permitLink.searchParams.get('unitId')).toBe(unitB);
  expect(permitLink.searchParams.has('teamId')).toBe(false);
  const agendaLink = new URL((await page.getByRole('link', { name: 'Consultar agenda', exact: true }).getAttribute('href'))!, page.url());
  expect(agendaLink.searchParams.has('teamId')).toBe(false);
  expect(agendaLink.searchParams.has('from')).toBe(false);

  const beforeReturn = requests.length;
  await page.getByRole('combobox', { name: 'Unidade de trabalho', exact: true }).selectOption(unitA);
  await expect(team).toHaveValue('');
  await expect.poll(() => requests.slice(beforeReturn).some(url => url.searchParams.get('unitId') === unitA)).toBe(true);
  expect(requests.slice(beforeReturn).every(url => !url.searchParams.has('teamId'))).toBe(true);
  await page.getByRole('combobox', { name: 'Pesquisar em', exact: true }).selectOption('pts');
  await page.getByLabel('Pesquisar na plataforma', { exact: true }).fill('PT');
  await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/pts\?/);
  expect(new URL(page.url()).searchParams.has('teamId')).toBe(false);
  await expect(page.getByRole('table', { name: 'Permissões de trabalho', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('indicador de pendências abre os mesmos agendamentos bloqueados e preserva os filtros', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page, 'Engenheiro');
  const team = page.getByRole('combobox', { name: 'Equipe operacional', exact: true });
  await expect(team).toBeVisible();
  await page.getByLabel('Período de início', { exact: true }).fill('2020-01-01');
  await page.getByLabel('Período até', { exact: true }).fill('2035-12-31');
  await team.selectOption({ index: 1 });
  const teamId = await team.inputValue();
  await page.getByRole('combobox', { name: 'Tipo de serviço', exact: true }).selectOption({ index: 1 });
  const serviceId = await page.getByRole('combobox', { name: 'Tipo de serviço', exact: true }).inputValue();
  await page.getByLabel('Local / Área', { exact: true }).fill('Área A');
  const metric = page.getByRole('link', { name: /^Pendências documentais/ });
  await expect(metric).toBeVisible();
  await expect(page.getByRole('button', { name: 'Atualizar painel', exact: true })).toBeEnabled();
  const count = Number((await metric.locator('strong').innerText()).replace(/\./g, ''));
  expect(count).toBeGreaterThan(0);
  await metric.click();
  const target = new URL(page.url());
  expect(target.pathname).toBe('/app/agenda');
  expect(Object.fromEntries(target.searchParams)).toEqual({ from: '2020-01-01', to: '2035-12-31', teamId, serviceTypeId: serviceId, location: 'Área A', eligibility: 'blocked' });
  await expect(page.getByLabel('Documentação dos participantes', { exact: true })).toHaveValue('blocked');
  await expect(page.getByRole('table', { name: 'Atendimentos da agenda', exact: true }).locator('tbody').getByRole('row')).toHaveCount(count);
  await expect(page.getByText('AG-DEMO-221', { exact: true })).toHaveCount(0);

  await navigateWithinApp(page, '/app/dashboard');
  await page.getByRole('link', { name: 'Conferir requisitos por participante', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/pendencias\?/);
  await expect(page.getByLabel('Situação documental', { exact: true })).toHaveValue('pending');
  expect(errors).toEqual([]);
});
