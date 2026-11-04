import { z } from 'zod';
import type { ServiceTemplateQuestionDto } from '../../shared/contracts/service-templates';

const question = z.object({
  id: z.string().min(1).max(120).regex(/^[a-zA-Z0-9:_-]+$/),
  label: z.string().trim().min(3, 'Descreva a pergunta com pelo menos 3 caracteres.').max(500, 'Use até 500 caracteres.'),
  required: z.boolean(),
  blockingAnswers: z.array(z.enum(['YES', 'NO'])).max(1, 'Selecione uma resposta bloqueadora.'),
});
export const templateSchema = z.object({ questions: z.array(question).min(1, 'Adicione pelo menos uma pergunta.').max(30, 'Use até 30 perguntas.') }).superRefine((value, context) => {
  if (new Set(value.questions.map(item => item.id)).size !== value.questions.length) context.addIssue({ code: 'custom', path: ['questions'], message: 'As perguntas precisam de identificações diferentes.' });
});
export type TemplateValues = z.infer<typeof templateSchema>;
export const publicationSchema = z.object({ reason: z.string().trim().min(10, 'Descreva o motivo com pelo menos 10 caracteres.').max(2000, 'Use até 2.000 caracteres.'), confirmed: z.boolean().refine(value => value, 'Confirme a publicação deste rascunho.') });
export type PublicationValues = z.infer<typeof publicationSchema>;
export const emptyQuestion = (): ServiceTemplateQuestionDto => ({ id: crypto.randomUUID(), label: '', required: true, blockingAnswers: ['NO'] });
export const templateErrorMessage = (error: unknown) => {
  const value = error as { status?: number; message?: string };
  if (value?.status === 412 || value?.status === 428) return 'O template mudou. Seu preenchimento foi preservado; confira a revisão atual antes de continuar.';
  return value?.message || 'Não foi possível concluir a ação. Tente novamente.';
};
