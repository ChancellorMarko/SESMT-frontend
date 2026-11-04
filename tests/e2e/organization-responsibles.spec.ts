import { expect, test } from '@playwright/test';
import type { AssigneeDto, OrganizationDto, PageDto, UserDto } from '../../src/shared/contracts';
import type { AccountInvitationAcceptDto, AccountInvitationSummaryDto } from '../../src/shared/contracts/account-invitations';
import { loginDemo, navigateWithinApp } from './helpers';

test('responsáveis organizacionais alcançam 125 pessoas, preservam vínculos e respeitam a unidade editada', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await loginDemo(page, 'Administrador');

  const seeded = await page.evaluate(async () => {
    const clientUrl = '/src/shared/api/client.ts'; const { api } = await import(clientUrl);
    const companyId = '00000000-0000-4000-8000-000000000001';
    const unitId = '00000000-0000-4000-8000-000000000002';
    const sectorId = '00000000-0000-4000-8000-000000000005';
    const organization = await api.get('/organization', { query: { unitId } }) as OrganizationDto;
    const unit = organization.units.find(item => item.id === unitId);
    const otherUnit = organization.units.find(item => item.id !== unitId);
    if (!unit || !otherUnit || !unit.responsibleIds?.length) throw new Error('Unidades e responsável original ausentes da demonstração.');
    const people: Pick<UserDto, 'id' | 'displayName'>[] = [], suffix = String(Date.now());
    for (let start = 1; start <= 125; start += 15) {
      const batch = await Promise.all(Array.from({ length: Math.min(15, 126 - start) }, async (_, index) => {
        const sequence = String(start + index).padStart(3, '0');
        // The demo administrator has a sector-restricted grant, so invitations
        // must retain an allowed sector rather than grant an unrestricted scope.
        const scope = { companyIds: [companyId], unitIds: [unitId], sectorIds: [sectorId], teamIds: [], ownOnly: false };
        const invited = await api.post('/users', { displayName: `ZZ Responsável Escala ${sequence}`, email: `responsavel-escala-${suffix}-${sequence}@example.invalid`, roles: ['HR'], scope }) as UserDto;
        // Synthetic eligible people must complete first access, without administrative activation.
        const invitation = await api.get(`/users/${invited.id}/invitation`) as AccountInvitationSummaryDto;
        if (!invitation.demoActivationPath) throw new Error('Convite demonstrativo de primeiro acesso ausente.');
        const token = new URLSearchParams(new URL(invitation.demoActivationPath, location.origin).hash.slice(1)).get('token');
        if (!token) throw new Error('Código de primeiro acesso ausente do convite demonstrativo.');
        const accepted = await api.post('/auth/invitations/accept', { token, newPassword: 'Senha sintética de escala 2026!' }) as AccountInvitationAcceptDto;
        if (accepted.nextStep !== 'LOGIN') throw new Error('O primeiro acesso da pessoa sintética não foi concluído.');
        return { id: invited.id, displayName: invited.displayName };
      }));
      people.push(...batch);
    }
    const first = await api.get('/assignees', { query: { unitId, purpose: 'UNIT_RESPONSIBLE', page: 1, pageSize: 100 } }) as PageDto<AssigneeDto>;
    const target = people.find(person => !first.items.some(item => item.id === person.id));
    const second = people.find(person => person.id !== target?.id && first.items.some(item => item.id === person.id));
    if (!target || !second) throw new Error('Os alvos precisam ser distintos e o principal deve estar além dos primeiros 100 elegíveis.');
    return { unit, otherUnit, target, second, unitId };
  });

  const lookups: URL[] = [], writes: unknown[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/v1/assignees' && url.searchParams.get('purpose') === 'UNIT_RESPONSIBLE') lookups.push(url);
    if (request.method() === 'PATCH' && url.pathname === `/api/v1/units/${seeded.unitId}`) writes.push(request.postDataJSON());
  });
  await navigateWithinApp(page, '/app/organizacao');
  await page.getByRole('button', { name: `Editar ${seeded.unit.name}`, exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar unidade', exact: true });
  const select = editor.getByLabel('Responsáveis elegíveis', { exact: true });
  const save = editor.getByRole('button', { name: 'Salvar cadastro', exact: true });
  const selectedIds = () => select.evaluate((element: HTMLSelectElement) => Array.from(element.selectedOptions, option => option.value).sort());
  await expect(save).toBeEnabled();
  const originalIds = seeded.unit.responsibleIds!.slice().sort();
  await expect.poll(selectedIds).toEqual(originalIds);
  expect(lookups.some(url => Boolean(url.searchParams.get('ids')))).toBe(true);
  expect(lookups.filter(url => !url.searchParams.has('ids')).every(url => url.searchParams.get('page') === '1' && url.searchParams.get('pageSize') === '20')).toBe(true);

  const search = editor.getByRole('searchbox', { name: 'Buscar responsáveis da unidade', exact: true });
  const requestCount = lookups.length;
  await search.fill(seeded.target.displayName);
  expect(lookups).toHaveLength(requestCount); expect(writes).toEqual([]);
  await search.press('Enter');
  await expect(select.getByRole('option', { name: seeded.target.displayName, exact: true })).toHaveCount(1);
  expect(writes).toEqual([]);
  const expectedIds = [...originalIds, seeded.target.id].sort();
  await select.selectOption(expectedIds); await expect(save).toBeEnabled();
  await expect.poll(selectedIds).toEqual(expectedIds);
  await search.fill(''); await editor.getByRole('button', { name: 'Pesquisar responsáveis da unidade', exact: true }).click();
  await expect(save).toBeEnabled();
  await expect(select.getByRole('option', { name: seeded.target.displayName, exact: true })).toHaveCount(1);
  await editor.getByRole('button', { name: 'Próxima: responsáveis da unidade', exact: true }).click();
  await expect(editor.getByRole('navigation', { name: 'Paginação de responsáveis da unidade', exact: true })).toContainText('Página 2');
  await expect(save).toBeEnabled(); await expect.poll(selectedIds).toEqual(expectedIds);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`responsaveis-unidade-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await save.click(); await expect(editor).toHaveCount(0);
  await expect(page.getByText('Cadastro organizacional salvo.', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ responsibleIds: expect.arrayContaining(expectedIds) });
  const savedIds = await page.evaluate(async unitId => {
    const clientUrl = '/src/shared/api/client.ts'; const { api } = await import(clientUrl);
    const organization = await api.get('/organization', { query: { unitId } }) as OrganizationDto;
    return organization.units.find(unit => unit.id === unitId)?.responsibleIds?.slice().sort();
  }, seeded.unitId);
  expect(savedIds).toEqual(expectedIds);

  await page.getByRole('button', { name: `Editar ${seeded.unit.name}`, exact: true }).click();
  await expect(save).toBeEnabled(); await expect.poll(selectedIds).toEqual(expectedIds);
  await expect(select.getByRole('option', { name: seeded.target.displayName, exact: true })).toHaveCount(1);
  await search.fill(seeded.second.displayName); await editor.getByRole('button', { name: 'Pesquisar responsáveis da unidade', exact: true }).click();
  await select.selectOption([...expectedIds, seeded.second.id]); await expect(save).toBeEnabled();
  await expect.poll(selectedIds).toEqual([...expectedIds, seeded.second.id].sort());
  await editor.getByRole('button', { name: `Remover ${seeded.second.displayName}`, exact: true }).click();
  await expect(save).toBeEnabled(); await expect.poll(selectedIds).toEqual(expectedIds);
  await save.click(); await expect(editor).toHaveCount(0);
  expect(writes).toHaveLength(2); expect(writes[1]).toMatchObject({ responsibleIds: expect.arrayContaining(expectedIds) });
  expect((writes[1] as { responsibleIds: string[] }).responsibleIds).not.toContain(seeded.second.id);

  await expect(page.getByLabel('Unidade de trabalho', { exact: true })).toHaveValue(seeded.unitId);
  const beforeOtherUnit = lookups.length;
  await page.getByRole('button', { name: `Editar ${seeded.otherUnit.name}`, exact: true }).click();
  await expect(save).toBeEnabled(); await expect.poll(selectedIds).toEqual(seeded.otherUnit.responsibleIds!.slice().sort());
  await expect(select.getByRole('option', { name: /^ZZ Responsável Escala/ })).toHaveCount(0);
  expect(lookups.slice(beforeOtherUnit).length).toBeGreaterThan(0);
  expect(lookups.slice(beforeOtherUnit).every(url => url.searchParams.get('unitId') === seeded.otherUnit.id)).toBe(true);
  expect(lookups.every(url => url.searchParams.has('ids') ? url.searchParams.get('pageSize') === '100' : url.searchParams.get('pageSize') === '20')).toBe(true);
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click(); await expect(editor).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
