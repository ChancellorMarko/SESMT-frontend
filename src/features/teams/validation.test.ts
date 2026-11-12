import { describe, expect, it } from 'vitest';
import { normalizedTeamText, teamFormSchema } from './validation';

const draft = () => ({ name: ' Equipe de manutenção ', unitId: 'unit', chiefId: 'worker-1', members: [{ workerId: 'worker-1', serviceFunction: ' Executante ' }] });
describe('validação de equipe', () => {
  it('normaliza espaços e exige um chefe participante', () => {
    expect(teamFormSchema.parse(draft())).toMatchObject({ name: 'Equipe de manutenção', members: [{ serviceFunction: 'Executante' }] });
    const result = teamFormSchema.safeParse({ ...draft(), chiefId: 'worker-2' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(['chiefId']);
  });
  it('aponta duplicidade no participante para correção sem limpar o formulário', () => {
    const value = draft();
    value.members.push({ workerId: 'worker-1', serviceFunction: 'Apoio' });
    const result = teamFormSchema.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(['members', 1, 'workerId']);
  });
  it('não aceita composição vazia, função sem conteúdo ou campos geridos pelo servidor', () => {
    expect(teamFormSchema.safeParse({ ...draft(), members: [] }).success).toBe(false);
    expect(teamFormSchema.safeParse({ ...draft(), members: [{ workerId: 'worker-1', serviceFunction: ' ' }] }).success).toBe(false);
    expect(teamFormSchema.safeParse({ ...draft(), companyId: 'forged', revision: 500 }).success).toBe(false);
    expect(teamFormSchema.safeParse({ ...draft(), members: [{ ...draft().members[0], name: 'Nome forjado' }] }).success).toBe(false);
  });
  it('explica o campo extra com a mensagem do formulário e não com a genérica', () => {
    const extra = teamFormSchema.safeParse({ ...draft(), revision: 500 });
    expect(extra.success ? [] : extra.error.issues.map(issue => issue.message)).toContain('O envio contém campos que são geridos pelo servidor.');
    const member = teamFormSchema.safeParse({ ...draft(), members: [{ ...draft().members[0], name: 'Nome forjado' }] });
    expect(member.success ? [] : member.error.issues.map(issue => issue.message)).toContain('Envie somente o trabalhador e sua função no serviço.');
  });
  it('compara nomes sem depender de acentos, maiúsculas ou espaços repetidos', () => {
    expect(normalizedTeamText('  EQUIPE de  MANUTENÇÃO ')).toBe(normalizedTeamText('Equipe de manutencao'));
  });
});
