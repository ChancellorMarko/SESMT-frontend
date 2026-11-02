import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { isCivilDate } from '../documents/validation';
import { UnsavedChanges } from '../workers/UnsavedChanges';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { PermitOptionsDto } from '../../shared/contracts/work-permits';
import type { DesignationDto, DesignationWriteDto } from '../../shared/contracts/designations';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import styles from './Designations.module.css';

export const designationFormSchema = z.object({
  responsibleId: z.string().min(1, 'Selecione o responsável.'),
  locationPattern: z.string().max(200),
  validFrom: z.string().refine(isCivilDate, 'Informe uma data inicial válida.'),
  validUntil: z.string().refine(isCivilDate, 'Informe uma data final válida.'),
  notes: z.string().max(2000).optional(),
}).refine(v => v.validFrom <= v.validUntil, { message: 'O fim deve ser posterior ao início.', path: ['validUntil'] });

type FormValues = {
  responsibleId: string;
  locationPattern: string;
  validFrom: string;
  validUntil: string;
  notes?: string;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Erro inesperado. Tente novamente.';
}

export function DesignationFormPage() {
  const { sessionKey, unitId, can } = useSession();

  const options = useQuery({
    queryKey: ['permit-options', sessionKey, unitId],
    queryFn: ({ signal }) => api.get<PermitOptionsDto>('/permit-options', { signal, query: { unitId } }),
    enabled: can('appointments.write') && Boolean(unitId),
  });

  if (!can('appointments.write')) return <EmptyState title="Acesso restrito" description="Seu perfil não pode criar designações." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" />;
  if (options.isPending) return <Spinner />;
  if (options.isError && !options.data) return <div className="panel stack"><Feedback tone="danger">Não foi possível carregar as opções.</Feedback><Button variant="secondary" onClick={() => void options.refetch()}>Tentar novamente</Button></div>;
  if (!options.data) return <EmptyState title="Opções indisponíveis" />;
  return <DesignationForm key={`${sessionKey}:${unitId}`} unitId={unitId} options={options.data} optionsVerified={!options.isError && !options.isFetching} retryOptions={() => void options.refetch()} />;
}

function DesignationForm({ unitId, options, optionsVerified, retryOptions }: { unitId: string; options: PermitOptionsDto; optionsVerified: boolean; retryOptions: () => void }) {
  const navigate = useNavigate(); const client = useQueryClient();
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [serviceError, setServiceError] = useState(''); const [saveError, setSaveError] = useState('');
  const pendingRequest = useRef<AbortController | null>(null);
  const lastRequest = useRef<{ payload: string; key: string } | undefined>(undefined);
  useEffect(() => () => { pendingRequest.current?.abort(); pendingRequest.current = null; }, []);
  const form = useForm<FormValues>({
    resolver: zodResolver(designationFormSchema),
    defaultValues: { responsibleId: '', locationPattern: '', validFrom: '', validUntil: '', notes: '' },
  });

  const error = (name: keyof FormValues) => form.formState.errors[name]?.message;
  const unavailableServices = selectedServices.filter(id => !options.services.some(service => service.id === id));

  function toggleService(id: string, selected: boolean) {
    setSelectedServices(current => selected ? [...new Set([...current, id])] : current.filter(v => v !== id));
    setServiceError('');
  }

  async function submit(values: FormValues) {
    if (pendingRequest.current) return;
    setSaveError(''); setServiceError('');
    if (!optionsVerified) { setSaveError('Aguarde a atualização das opções antes de criar a designação.'); return; }
    if (selectedServices.length === 0) { setServiceError('Selecione ao menos um serviço.'); return; }
    if (selectedServices.some(id => !options.services.some(service => service.id === id))) { setServiceError('Um serviço selecionado deixou de estar disponível. Confira os serviços desta unidade.'); return; }
    if (!options.responsibles.some(responsible => responsible.id === values.responsibleId)) { setSaveError('Selecione um responsável disponível nesta unidade.'); return; }
    const payload: DesignationWriteDto & { unitId: string } = {
      ...values, serviceTypeIds: [...selectedServices], unitId,
    };
    const serialized = JSON.stringify(payload);
    if (lastRequest.current?.payload !== serialized) lastRequest.current = { payload: serialized, key: crypto.randomUUID() };
    const controller = new AbortController(); pendingRequest.current = controller;
    try {
      const saved = await api.post<DesignationDto>('/designations', payload, { query: { unitId }, signal: controller.signal, idempotencyKey: lastRequest.current.key });
      if (controller.signal.aborted) return;
      if (saved.unitId !== unitId) throw new Error('A designação retornada pertence a outra unidade. Seu preenchimento foi preservado.');
      void client.invalidateQueries({ queryKey: ['designations'] });
      void client.invalidateQueries({ queryKey: ['designation-coverage'] });
      navigate(`/app/designacoes/${saved.id}`, { state: { success: 'Designação criada.' } });
    } catch (failure) { if (!controller.signal.aborted) setSaveError(errorMessage(failure)); }
    finally { if (pendingRequest.current === controller) pendingRequest.current = null; }
  }

  return <div className="stack">
    <UnsavedChanges dirty={form.formState.isDirty || selectedServices.length > 0} busy={form.formState.isSubmitting} protectContext />
    <PageHeader
      eyebrow="OPERAÇÃO"
      title="Nova designação"
      description="Vincule um responsável operacional aos serviços e ao período de vigência."
      actions={<Link className="button button--secondary" to="/app/designacoes">Voltar</Link>}
    />
    <form className="panel stack" onSubmit={form.handleSubmit(submit)} noValidate>
      {saveError && <Feedback tone="danger">{saveError}</Feedback>}
      {!optionsVerified && <Feedback tone="warning">As opções estão sendo atualizadas ou não puderam ser confirmadas. Seu preenchimento foi preservado.<Button variant="secondary" onClick={retryOptions}>Atualizar opções</Button></Feedback>}
      <fieldset className={`stack ${styles.formFields}`} disabled={form.formState.isSubmitting} aria-label="Dados da designação">
        <div className="form-grid">
          <Field label="Responsável *" error={error('responsibleId')}>
            <select {...form.register('responsibleId')}>
              <option value="">Selecione o responsável</option>
              {options.responsibles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Local / alcance" error={error('locationPattern')}>
            <input maxLength={200} placeholder="Vazio = qualquer local" {...form.register('locationPattern')} />
          </Field>
          <Field label="Início da vigência *" error={error('validFrom')}>
            <input type="date" {...form.register('validFrom')} />
          </Field>
          <Field label="Fim da vigência *" error={error('validUntil')}>
            <input type="date" {...form.register('validUntil')} />
          </Field>
          <div className={styles.wide}>
            <Field label="Observações" error={error('notes')}>
              <textarea rows={2} maxLength={2000} placeholder="Opcional" {...form.register('notes')} />
            </Field>
          </div>
        </div>

        <fieldset className={styles.formFields}>
          <legend>Serviços cobertos *</legend>
          {serviceError && <Feedback tone="danger">{serviceError}</Feedback>}
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Selecione os serviços que esta designação cobre. A cobertura será exigida em cada serviço do agendamento.</p>
          <div className={styles.serviceChoices}>
            {options.services.map(service => {
              const checked = selectedServices.includes(service.id);
              return <label key={service.id} className={`${styles.serviceChoice} ${checked ? styles.serviceSelected : ''}`}>
                <input type="checkbox" checked={checked} onChange={e => toggleService(service.id, e.target.checked)} style={{ marginRight: 8 }} />
                {service.name}
              </label>;
            })}
          </div>
          {unavailableServices.length > 0 && <Feedback tone="warning">Um serviço selecionado deixou de estar disponível.<Button variant="secondary" onClick={() => { setSelectedServices(selectedServices.filter(id => !unavailableServices.includes(id))); setServiceError(''); }}>Remover serviços indisponíveis</Button></Feedback>}
        </fieldset>
      </fieldset>
      <div className="actions">
        <Button type="submit" disabled={form.formState.isSubmitting || !optionsVerified || !options.services.length || !options.responsibles.length}>
          {form.formState.isSubmitting ? 'Criando…' : 'Criar designação'}
        </Button>
      </div>
    </form>
  </div>;
}
