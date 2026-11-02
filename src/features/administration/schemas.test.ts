import { describe, expect, it } from 'vitest';
import type { MeDto } from '../../shared/contracts';
import { delegatedScope, documentTypePayload, documentTypeSchema, localAccessInstant, userAccessSchema, type DocumentTypeForm, type UserAccessForm } from './schemas';

const typeForm: DocumentTypeForm = {
  code: 'PROCEDIMENTO', name: 'Procedimento documental', category: 'Administrativo', requiredFields: ['title'], allowedAccessClasses: ['INTERNAL', 'RESTRICTED'], defaultAccessClass: 'INTERNAL', mimeTypes: 'application/pdf\napplication/pdf', maxSizeMb: 5, renewalEnabled: false, noticeDays: 20, periodMonths: 0, retentionCode: 'POL-EXEMPLO', retentionVersion: '1', retentionSource: 'Política sintética de teste', reviewRequired: true, signatureRequired: true, allowSelfApproval: false, allowMultipleActiveVersions: false,
};
const me: MeDto = { user: { id: 'manager', displayName: 'Pessoa de teste', email: 'teste@example.invalid' }, roles: ['ADMIN'], permissions: ['users.manage'], scope: { companyIds: ['company-allowed'], unitIds: ['unit-allowed'], sectorIds: ['sector-allowed'], teamIds: [], ownOnly: false }, accessExpiresAt: '2099-01-01T00:00:00Z' };
const userForm: UserAccessForm = { displayName: 'Pessoa de teste', email: 'teste@example.invalid', roles: ['HR'], companyIds: ['company-allowed'], unitIds: ['unit-allowed'], teamIds: [], ownOnly: false, status: 'ACTIVE', expiresAt: '' };

describe('políticas documentais e concessão de acesso', () => {
  it('envia a concessão no fuso de São Paulo, inclusive a virada de dia UTC', () => {
    expect(localAccessInstant('2099-01-01T23:30')).toBe('2099-01-02T02:30:00.000Z');
    expect(localAccessInstant('2099-01-01T12:45:30')).toBe('2099-01-01T15:45:30.000Z');
    expect(delegatedScope({ ...userForm, expiresAt: '2099-01-01T23:30' }, me).expiresAt).toBe('2099-01-02T02:30:00.000Z');
    expect(() => delegatedScope({ ...userForm, expiresAt: '2099-02-30T12:00' }, me)).toThrow('data e hora válidas');
  });
  it('recusa classificação padrão que não consta entre as permitidas', () => {
    const result = documentTypeSchema.safeParse({ ...typeForm, defaultAccessClass: 'MEDICAL' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === 'defaultAccessClass')).toBe(true);
  });
  it('conserva campos obrigatórios, deduplica MIME e omite periodicidade quando renovação está desligada', () => {
    const payload = documentTypePayload(documentTypeSchema.parse(typeForm));
    expect(payload.requiredFields).toEqual(expect.arrayContaining(['typeId', 'ownerId', 'accessClass', 'issueDate']));
    expect(payload.allowedMimeTypes).toEqual(['application/pdf']);
    expect(payload.maxFileSizeBytes).toBe(5 * 1024 * 1024);
    expect(payload.renewalPolicy).toEqual({ enabled: false, noticeDays: 20 });
    expect(payload).not.toHaveProperty('revision');
  });
  it('exige periodicidade positiva somente quando o tipo usa renovação', () => {
    expect(documentTypeSchema.safeParse(typeForm).success).toBe(true);
    expect(documentTypeSchema.safeParse({ ...typeForm, renewalEnabled: true }).success).toBe(false);
  });
  it('impede concessão de unidade fora do escopo antes de enviar a alteração', () => {
    expect(() => delegatedScope({ ...userForm, unitIds: ['unit-other'] }, me)).toThrow('fora do seu escopo');
  });
  it('recusa restrições históricas externas sem removê-las silenciosamente', () => {
    const original = { companyIds: ['company-allowed'], unitIds: ['unit-allowed'], sectorIds: ['sector-allowed', 'sector-other'], teamIds: [], ownOnly: true };
    expect(() => delegatedScope(userForm, me, original)).toThrow('setores fora do seu escopo');
    expect(original.sectorIds).toEqual(['sector-allowed', 'sector-other']);
  });
  it('não amplia equipes, dados próprios ou prazo além da autoridade delegante', () => {
    expect(() => delegatedScope(userForm, { ...me, scope: { ...me.scope, teamIds: ['team-a'] } })).toThrow('equipes');
    expect(() => delegatedScope(userForm, { ...me, scope: { ...me.scope, ownOnly: true } })).toThrow('dados próprios');
    expect(() => delegatedScope(userForm, { ...me, scope: { ...me.scope, expiresAt: '2099-01-02T00:00:00Z' } })).toThrow('vencimento');
    expect(delegatedScope({ ...userForm, teamIds: ['team-a'] }, { ...me, scope: { ...me.scope, teamIds: ['team-a'] } }).teamIds).toEqual(['team-a']);
  });
  it('não concede empresas externas mesmo que a unidade permaneça autorizada', () => {
    expect(() => delegatedScope({ ...userForm, companyIds: ['company-other'] }, me)).toThrow('empresa fora do seu escopo');
  });
  it('exige concessão temporária para auditor e recusa prazo expirado', () => {
    expect(userAccessSchema.safeParse({ ...userForm, roles: ['AUDITOR'] }).success).toBe(false);
    expect(userAccessSchema.safeParse({ ...userForm, roles: ['AUDITOR'], expiresAt: '2000-01-01T12:00' }).success).toBe(false);
    expect(userAccessSchema.safeParse({ ...userForm, roles: ['AUDITOR'], expiresAt: '2099-01-01T12:00' }).success).toBe(true);
  });
  it('recusa datas civis inexistentes e horários normalizados pelo JavaScript', () => {
    for (const expiresAt of ['2099-02-29T12:00', '2099-02-30T12:00', '2099-04-31T12:00', '2099-01-01T24:00', '2099-01-01']) {
      expect(userAccessSchema.safeParse({ ...userForm, expiresAt }).success, expiresAt).toBe(false);
      expect(userAccessSchema.safeParse({ ...userForm, status: 'DISABLED', expiresAt }).success, expiresAt).toBe(false);
    }
    expect(userAccessSchema.safeParse({ ...userForm, expiresAt: '2096-02-29T12:00' }).success).toBe(true);
    expect(userAccessSchema.safeParse({ ...userForm, status: 'DISABLED', expiresAt: '2000-01-01T12:00' }).success).toBe(true);
  });
  it('recusa limites que se tornam zero, infinitos ou bytes sem precisão', () => {
    for (const maxSizeMb of [Number.MIN_VALUE, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER]) {
      expect(documentTypeSchema.safeParse({ ...typeForm, maxSizeMb }).success).toBe(false);
    }
    expect(documentTypeSchema.safeParse({ ...typeForm, maxSizeMb: 0.1 }).success).toBe(true);
  });
});
