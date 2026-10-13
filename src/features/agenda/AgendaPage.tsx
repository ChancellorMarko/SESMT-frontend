import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { CalendarDays, Filter, List, MapPin, Users } from 'lucide-react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AppointmentDto, PermitOptionsDto } from '../../shared/contracts/work-permits';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { AgendaCalendarView } from './AgendaCalendarView';
import { appointmentDateOnly, appointmentLabels, appointmentTimeOnly, errorMessage } from './support';
import styles from './Agenda.module.css';

export function AgendaPage() {
  const { unitId, sessionKey, can } = useSession();
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  // Search and filter parameters
  const q = params.get('q') || '';
  const status = params.get('status') || '';
  const teamId = params.get('teamId') || '';
  const responsibleId = params.get('responsibleId') || '';
  const serviceTypeId = params.get('serviceTypeId') || '';
  const filterLocation = params.get('location') || '';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const blockedOnly = params.get('eligibility') === 'blocked';
  const view = params.get('view') === 'calendar' ? 'calendar' : 'list';

  const [search, setSearch] = useState(q);
  const [locationInput, setLocationInput] = useState(filterLocation);
  const [showAdvanced, setShowAdvanced] = useState(Boolean(from || to || teamId || responsibleId || serviceTypeId || filterLocation));

  // Sync internal input state with params
  useEffect(() => { setSearch(q); }, [q]);
  useEffect(() => { setLocationInput(filterLocation); }, [filterLocation]);

  // Restore filters from sessionStorage if opened without query parameters
  useEffect(() => {
    if (!unitId) return;
    const storageKey = `agenda_filters_${unitId}`;
    if (!location.search && typeof window !== 'undefined') {
      const saved = window.sessionStorage?.getItem(storageKey);
      if (saved) {
        setParams(new URLSearchParams(saved), { replace: true });
      }
    }
  }, [unitId, location.search, setParams]);

  // Persist current filters in sessionStorage
  useEffect(() => {
    if (!unitId || typeof window === 'undefined') return;
    const storageKey = `agenda_filters_${unitId}`;
    if (params.toString()) {
      window.sessionStorage?.setItem(storageKey, params.toString());
    }
  }, [unitId, params]);

  // Fetch options (teams, services, responsibles) for filters
  const optionsQuery = useQuery({
    queryKey: ['permit-options', sessionKey, unitId],
    queryFn: ({ signal }) => api.get<PermitOptionsDto>('/permit-options', { signal, query: { unitId } }),
    enabled: can('appointments.read') && Boolean(unitId),
  });

  const appointments = useQuery({
    queryKey: ['appointments', sessionKey, unitId, q, status, teamId, responsibleId, serviceTypeId, filterLocation, from, to, blockedOnly],
    queryFn: ({ signal }) => api.get<AppointmentDto[]>('/appointments', {
      signal,
      query: {
        unitId,
        q,
        status,
        teamId: teamId || undefined,
        responsibleId: responsibleId || undefined,
        serviceTypeId: serviceTypeId || undefined,
        location: filterLocation || undefined,
        from: from || undefined,
        to: to || undefined,
        eligibility: blockedOnly ? 'blocked' : undefined,
      },
    }),
    enabled: can('appointments.read') && Boolean(unitId),
  });

  const filtered = Boolean(q || status || teamId || responsibleId || serviceTypeId || filterLocation || from || to || blockedOnly);

  function change(key: string, value: string) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }

  function setView(nextView: 'list' | 'calendar') {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (nextView === 'calendar') next.set('view', 'calendar');
      else next.delete('view');
      return next;
    });
  }

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (search.trim()) next.set('q', search.trim());
      else next.delete('q');
      if (locationInput.trim()) next.set('location', locationInput.trim());
      else next.delete('location');
      return next;
    });
  }

  function clearFilters() {
    if (unitId && typeof window !== 'undefined') {
      window.sessionStorage?.removeItem(`agenda_filters_${unitId}`);
    }
    setParams(view === 'calendar' ? { view: 'calendar' } : {});
    setSearch('');
    setLocationInput('');
  }

  if (!can('appointments.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não possui acesso à agenda." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade para consultar os serviços agendados." />;

  const options = optionsQuery.data;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Planejamento e atendimento"
        title="Agenda de serviços"
        description="Organize a equipe, o horário e os participantes de cada serviço. A liberação para executar acontece na PT em campo."
        actions={
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div className={styles.viewToggle} role="group" aria-label="Visualização da agenda">
              <button
                type="button"
                className={`${styles.toggleBtn} ${view === 'list' ? styles.toggleBtnActive : ''}`}
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
              >
                <List size={15} aria-hidden="true" /> Lista
              </button>
              <button
                type="button"
                className={`${styles.toggleBtn} ${view === 'calendar' ? styles.toggleBtnActive : ''}`}
                onClick={() => setView('calendar')}
                aria-pressed={view === 'calendar'}
              >
                <CalendarDays size={15} aria-hidden="true" /> Calendário
              </button>
            </div>
            {can('appointments.write') && (
              <Link className="button button--primary" to="/app/agenda/novo">
                Agendar serviço
              </Link>
            )}
          </div>
        }
      />

      <form className="panel stack" onSubmit={handleSearchSubmit} role="search" aria-label="Filtros da agenda">
        <div className="form-grid">
          <Field label="Buscar atendimento">
            <input
              maxLength={200}
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Código, serviço, equipe, responsável ou local"
            />
          </Field>
          <Field label="Situação do agendamento">
            <select value={status} onChange={event => change('status', event.target.value)}>
              <option value="">Todas as situações</option>
              {Object.entries(appointmentLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          {can('eligibility.read') && (
            <Field label="Documentação dos participantes">
              <select value={blockedOnly ? 'blocked' : ''} onChange={event => change('eligibility', event.target.value)}>
                <option value="">Todos os atendimentos</option>
                <option value="blocked">Com pendências documentais</option>
              </select>
            </Field>
          )}
        </div>

        {showAdvanced && (
          <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
            <div className="form-grid">
              <Field label="Período inicial (de)">
                <input
                  type="date"
                  value={from}
                  onChange={event => change('from', event.target.value)}
                  aria-label="Data inicial do filtro"
                />
              </Field>
              <Field label="Período final (até)">
                <input
                  type="date"
                  value={to}
                  onChange={event => change('to', event.target.value)}
                  aria-label="Data final do filtro"
                />
              </Field>
              <Field label="Equipe">
                <select value={teamId} onChange={event => change('teamId', event.target.value)}>
                  <option value="">Todas as equipes</option>
                  {options?.teams.filter(t => t.unitId === unitId).map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Responsável operacional">
                <select value={responsibleId} onChange={event => change('responsibleId', event.target.value)}>
                  <option value="">Todos os responsáveis</option>
                  {options?.responsibles.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Serviço">
                <select value={serviceTypeId} onChange={event => change('serviceTypeId', event.target.value)}>
                  <option value="">Todos os serviços</option>
                  {options?.services.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Local do serviço">
                <input
                  maxLength={100}
                  value={locationInput}
                  onChange={event => setLocationInput(event.target.value)}
                  placeholder="Ex.: Área A, Galpão..."
                />
              </Field>
            </div>
          </div>
        )}

        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="secondary" type="submit">Pesquisar</Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setShowAdvanced(prev => !prev)}
            >
              <Filter size={14} aria-hidden="true" /> {showAdvanced ? 'Menos filtros' : 'Filtros avançados'}
            </Button>
            {filtered && <Button variant="ghost" type="button" onClick={clearFilters}>Limpar filtros</Button>}
          </div>
          <span className="muted" style={{ alignSelf: 'center', fontSize: '12px' }}>
            Horários no fuso de Brasília (America/Sao_Paulo)
          </span>
        </div>
      </form>

      {appointments.isPending ? (
        <Spinner />
      ) : appointments.isError ? (
        <div className="panel stack">
          <Feedback tone="danger">{errorMessage(appointments.error)}</Feedback>
          <Button variant="secondary" onClick={() => void appointments.refetch()}>Tentar novamente</Button>
        </div>
      ) : !appointments.data?.length ? (
        <EmptyState
          title={filtered ? 'Nenhum atendimento encontrado' : 'Nenhum serviço agendado'}
          description={filtered ? 'Ajuste a pesquisa ou limpe os filtros para encontrar outros registros.' : 'Agende um serviço para organizar o próximo atendimento da equipe.'}
        />
      ) : view === 'calendar' ? (
        <AgendaCalendarView
          appointments={appointments.data}
          searchString={location.search}
          initialDate={from || (appointments.data[0] ? appointmentDateOnly(appointments.data[0].startsAt) : undefined)}
        />
      ) : (
        <>
          <p className="muted">{appointments.data.length} atendimento(s) encontrado(s) · Horários de Brasília</p>
          <div className={styles.cards}>
            {appointments.data.map(appointment => {
              const hasAdjustment = Boolean(
                appointment.confirmedStartsAt &&
                appointment.requestedStartsAt &&
                appointment.confirmedStartsAt !== appointment.requestedStartsAt
              );
              return (
                <article className={`panel ${styles.card}`} key={appointment.id}>
                  <div className={styles.cardHeader}>
                    <div>
                      <p className={styles.cardCode}>{appointment.code}</p>
                      <h2>
                        <Link to={`/app/agenda/${appointment.id}`} state={{ fromSearch: location.search }}>
                          {appointment.serviceLabel}
                        </Link>
                      </h2>
                      <p className="muted">{appointment.teamName}</p>
                    </div>
                    <Badge tone={appointment.status === 'CANCELED' ? 'neutral' : appointment.status === 'REQUESTED' ? 'warning' : 'success'}>
                      {appointmentLabels[appointment.status]}
                    </Badge>
                  </div>

                  <dl className={styles.metadata}>
                    <div>
                      <dt><CalendarDays size={13} aria-hidden="true" /> Início</dt>
                      <dd>
                        {formatDate(appointment.startsAt)}
                        {appointment.status === 'REQUESTED' && <small className="muted"> (Solicitado)</small>}
                        {appointment.status === 'CONFIRMED' && <small className="muted"> (Confirmado)</small>}
                        {hasAdjustment && <Badge tone="neutral">Horário ajustado</Badge>}
                      </dd>
                    </div>
                    <div>
                      <dt>Término previsto</dt>
                      <dd>{formatDate(appointment.endsAt)}</dd>
                    </div>
                    <div>
                      <dt><MapPin size={13} aria-hidden="true" /> Local</dt>
                      <dd>{appointment.location}</dd>
                    </div>
                    <div>
                      <dt><Users size={13} aria-hidden="true" /> Participantes</dt>
                      <dd>{appointment.participants.length} pessoa(s)</dd>
                    </div>
                    <div>
                      <dt>Responsável</dt>
                      <dd>{appointment.responsibleName}</dd>
                    </div>
                    <div>
                      <dt>Horário de solicitação</dt>
                      <dd>
                        {appointment.requestedStartsAt
                          ? `${appointmentTimeOnly(appointment.requestedStartsAt)} às ${appointmentTimeOnly(appointment.requestedEndsAt || appointment.endsAt)}`
                          : `${appointmentTimeOnly(appointment.startsAt)} às ${appointmentTimeOnly(appointment.endsAt)}`}
                      </dd>
                    </div>
                  </dl>

                  <div className="actions">
                    <Link
                      className="button button--secondary"
                      to={`/app/agenda/${appointment.id}`}
                      state={{ fromSearch: location.search }}
                    >
                      Consultar atendimento
                    </Link>
                    {appointment.permitId && can('permits.read') && (
                      <Link className="button button--ghost" to={`/app/pts/${appointment.permitId}`}>
                        Ver PT →
                      </Link>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
