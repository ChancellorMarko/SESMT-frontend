import { z } from 'zod';

const identifier = z.string().trim().min(1, 'Selecione o cadastro.').max(100, 'Identificador inválido.');
export const teamFormSchema = z.object({
  name: z.string().trim().min(3, 'Informe um nome com pelo menos 3 caracteres.').max(120, 'Use até 120 caracteres.'),
  unitId: identifier,
  chiefId: identifier,
  members: z.array(z.object({
    workerId: identifier,
    serviceFunction: z.string().trim().min(2, 'Informe a função no serviço.').max(80, 'Use até 80 caracteres.'),
  }).strict('Envie somente o trabalhador e sua função no serviço.')).min(1, 'Adicione pelo menos um participante.').max(100, 'A equipe pode ter até 100 participantes.'),
}).strict('O envio contém campos que são geridos pelo servidor.').superRefine((value, context) => {
  const seen = new Set<string>();
  value.members.forEach((member, index) => {
    if (seen.has(member.workerId)) context.addIssue({ code: 'custom', path: ['members', index, 'workerId'], message: 'Este trabalhador já participa da equipe.' });
    seen.add(member.workerId);
  });
  if (!value.members.some(member => member.workerId === value.chiefId)) context.addIssue({ code: 'custom', path: ['chiefId'], message: 'O chefe deve ser um dos participantes da equipe.' });
});

export type TeamFormValues = z.infer<typeof teamFormSchema>;
export const normalizedTeamText = (value: string) => value.trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

export function teamErrorMessage(error: unknown) {
  const value = error as { status?: number; message?: string };
  if (value?.status === 403) return 'Seu acesso não permite esta operação nesta equipe.';
  if (value?.status === 404) return 'Equipe não encontrada ou indisponível no seu escopo.';
  return value?.message || 'Não foi possível concluir a operação. Tente novamente.';
}
