import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { PermitOptionsDto } from '../../shared/contracts/work-permits';
import type { DesignationDto, DesignationWriteDto } from '../../shared/contracts/designations';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import styles from './Designations.module.css';

const schema = z.object({
  responsibleId: z.string().min(1, 'Selecione o responsável.'),
  locationPattern: z.string().max(200),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data inicial.'),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data final.'),
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
  const navigate = useNavigate();
  const client = useQueryClient();
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [serviceError, setServiceError] = useState('');
  const [saveError, setSaveError] = useState('');

  const options = useQuery({
    queryKey: ['permit-options', sessionKey, unitId],
    queryFn: ({ signal }) => api.get<PermitOptionsDto>('/permit-options', { signal, query: { unitId } }),
    enabled: can('appointments.write') && Boolean(unitId),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { responsibleId: '', locationPattern: '', validFrom: '', validUntil: '', notes: '' },
  });

  if (!can('appointments.write')) return <EmptyState title="Acesso restrito" description="Seu perfil não pode criar designações." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" />;
  if (options.isPending) return <Spinner />;
  if (options.isError) return <div className="panel stack"><Feedback tone="danger">Não foi possível carregar as opções.</Feedback><Button variant="secondary" onClick={() => void options.refetch()}>Tentar novamente</Button></div>;

  const error = (name: keyof FormValues) => form.formState.errors[name]?.message;

  function toggleService(id: string, selected: boolean) {
    setSelectedServices(current => selected ? [...new Set([...current, id])] : current.filter(v => v !== id));
    setServiceError('');
  }

  async function submit(values: FormValues) {
    setSaveError(''); setServiceError('');
    if (selectedServices.length === 0) { setServiceError('Selecione ao menos um serviço.'); return; }
    const payload: DesignationWriteDto & { unitId: string } = {
      ...values, serviceTypeIds: selectedServices, unitId: unitId!,
    };
    try {
      const saved = await api.post<DesignationDto>('/designations', payload, { query: { unitId } });
      await client.invalidateQueries({ queryKey: ['designations'] });
      navigate(`/app/designacoes/${saved.id}`, { state: { success: 'Designação criada.' } });
    } catch (failure) { setSaveError(errorMessage(failure)); }
  }

  return <div className="stack">
    <PageHeader
      eyebrow="OPERAÇÃO"
      title="Nova designação"
      description="Vincule um responsável operacional aos serviços e ao período de vigência."
      actions={<Link className="button button--secondary" to="/app/designacoes">Voltar</Link>}
    />
    <form className="panel stack" onSubmit={form.handleSubmit(submit)} noValidate>
      {saveError && <Feedback tone="danger">{saveError}</Feedback>}
      <fieldset className={`stack ${styles.formFields}`} disabled={form.formState.isSubmitting} aria-label="Dados da designação">
        <div className="form-grid">
          <Field label="Responsável *" error={error('responsibleId')}>
            <select {...form.register('responsibleId')}>
              <option value="">Selecione o responsável</option>
              {options.data?.responsibles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
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

        <div>
          <h3 style={{ marginBottom: 8 }}>Serviços cobertos *</h3>
          {serviceError && <Feedback tone="danger">{serviceError}</Feedback>}
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Selecione os serviços que esta designação cobre. A cobertura será exigida em cada serviço do agendamento.</p>
          <div className={styles.serviceChoices}>
            {options.data?.services.map(service => {
              const checked = selectedServices.includes(service.id);
              return <label key={service.id} className={`${styles.serviceChoice} ${checked ? styles.serviceSelected : ''}`}>
                <input type="checkbox" checked={checked} onChange={e => toggleService(service.id, e.target.checked)} style={{ marginRight: 8 }} />
                {service.name}
              </label>;
            })}
          </div>
        </div>
      </fieldset>
      <div className="actions">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Criando…' : 'Criar designação'}
        </Button>
      </div>
    </form>
  </div>;
}
