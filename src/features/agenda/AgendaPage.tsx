import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { CalendarDays, Clock3, List, Plus, Search } from 'lucide-react';
import { motion, useAnimationControls } from 'framer-motion';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AppointmentDto, PermitOptionsDto } from '../../shared/contracts/work-permits';
import { formatDate } from '../../shared/lib/format';
import { Button, EmptyState, Feedback, Field, Spinner } from '../../shared/ui';
import { AppliedFilters, FilterDisclosure, type AppliedFilter } from '../../shared/ui/filter-controls';
import { AgendaCalendarView } from './AgendaCalendarView';
import { AgendaList } from './AgendaList';
import { calendarDate, calendarToday } from './calendar';
import { agendaOrderError, agendaOrderLabels, agendaPeriodRange, orderAppointments, type AgendaOrder, type AgendaPeriod } from './agenda-presentation';
import { AgendaPeriodControls } from './AgendaPeriodControls';
import { appointmentDateOnly, appointmentLabels, errorMessage } from './support';
import styles from './Agenda.module.css';

export function AgendaPage() {
  const { unitId, sessionKey, can } = useSession();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const reduceMotion = useAppReducedMotion();
  const resultsMotion = useAnimationControls();
  const resultsRef = useRef<HTMLDivElement>(null);

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
  const orderError = agendaOrderError(params);
  const order = (orderError ? 'START_ASC' : params.get('order') || 'START_ASC') as AgendaOrder;
  const today = calendarToday();

  const [search, setSearch] = useState(q);
  const [locationInput, setLocationInput] = useState(filterLocation);
  const [showAdvanced, setShowAdvanced] = useState(Boolean(from || to || teamId || responsibleId || serviceTypeId || filterLocation));
  const searchRef = useRef<HTMLInputElement>(null);
  const quickPeriodChange = useRef<ReturnType<typeof agendaPeriodRange> | null>(null);
  const previousContext = useRef<string | null>(null);
  const context = JSON.stringify([sessionKey, unitId]);
  const [preparedContext, setPreparedContext] = useState('');
  const contextReady = preparedContext === context;
  const allowed = can('appointments.read');
  const fromError = from && !calendarDate(from) ? 'Informe uma data inicial válida.' : undefined;
  const toError = to && !calendarDate(to) ? 'Informe uma data final válida.'
    : calendarDate(from) && calendarDate(to) && from > to ? 'O fim do período deve ser igual ou posterior ao início.' : undefined;
  const periodError = fromError || toError;

  // Sync internal input state with params
  useEffect(() => { setSearch(q); }, [q]);
  useEffect(() => { setLocationInput(filterLocation); }, [filterLocation]);
  useEffect(() => {
    const expectedPeriod = quickPeriodChange.current;
    if (expectedPeriod) {
      // An earlier render must not consume a later quick-period selection.
      if (from === expectedPeriod.from && to === expectedPeriod.to) quickPeriodChange.current = null;
      return;
    }
    if (from || to || teamId || responsibleId || serviceTypeId || filterLocation) setShowAdvanced(true);
  }, [from, to, teamId, responsibleId, serviceTypeId, filterLocation]);

  // Restore once per context. An intentionally empty URL must remain empty on filter removal or Back.
  useEffect(() => {
    if (!unitId || !allowed) return;
    const storageKey = `agenda_filters_${unitId}`;
    const enteringContext = previousContext.current !== context;
    const changedContext = previousContext.current !== null && enteringContext;
    if (enteringContext) quickPeriodChange.current = null;
    previousContext.current = context;
    if (enteringContext && (!location.search || changedContext)) {
      let saved = '';
      try { saved = window.sessionStorage.getItem(storageKey) || ''; } catch { /* URL remains usable with blocked storage. */ }
      const next = new URLSearchParams(saved);
      if (next.toString() !== params.toString()) {
        setPreparedContext(''); setParams(next, { replace: true }); return;
      }
    }
    setPreparedContext(context);
    try {
      if (params.toString()) window.sessionStorage.setItem(storageKey, params.toString());
      else window.sessionStorage.removeItem(storageKey);
    } catch { /* URL remains the source of truth when persistence is unavailable. */ }
  }, [unitId, allowed, context, location.search, params, setParams]);

  // Fetch options (teams, services, responsibles) for filters
  const optionsQuery = useQuery({
    queryKey: ['permit-options', sessionKey, unitId],
    queryFn: ({ signal }) => api.get<PermitOptionsDto>('/permit-options', { signal, query: { unitId } }),
    enabled: allowed && Boolean(unitId) && contextReady,
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
    enabled: allowed && Boolean(unitId) && contextReady && !periodError && !orderError,
  });
  const orderedAppointments = useMemo(() => orderAppointments(appointments.data || [], order), [appointments.data, order]);

  function settleResults() { resultsMotion.stop(); resultsMotion.set({ opacity: 1, y: 0 }); }
  useEffect(() => {
    if (reduceMotion || !contextReady || appointments.isPending || appointments.isError || periodError || orderError || resultsRef.current?.contains(document.activeElement)) {
      resultsMotion.set({ opacity: 1, y: 0 }); return;
    }
    resultsMotion.set({ opacity: .6, y: 8 });
    void resultsMotion.start({ opacity: 1, y: 0, transition: { duration: .3, ease: [.22, 1, .36, 1] } });
    return () => resultsMotion.stop();
  }, [resultsMotion, reduceMotion, contextReady, appointments.isPending, appointments.isError, appointments.dataUpdatedAt, periodError, orderError, view, order]);

  const filtered = Boolean(q || status || teamId || responsibleId || serviceTypeId || filterLocation || from || to || blockedOnly);

  function change(key: string, value: string) {
    if (['from', 'to', 'teamId', 'responsibleId', 'serviceTypeId', 'location'].includes(key)) quickPeriodChange.current = null;
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }

  function removeFilter(key: string) {
    change(key, ''); searchRef.current?.focus();
  }

  function setView(nextView: 'list' | 'calendar') {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (nextView === 'calendar') next.set('view', 'calendar');
      else next.delete('view');
      return next;
    });
  }

  function setQuickPeriod(period: AgendaPeriod) {
    const range = agendaPeriodRange(period, today);
    if (quickPeriodChange.current || from !== range.from || to !== range.to) quickPeriodChange.current = range;
    setParams(previous => {
      const next = new URLSearchParams(previous);
      for (const key of ['from', 'to'] as const) { if (range[key]) next.set(key, range[key]); else next.delete(key); }
      if (view === 'calendar' && range.from) { next.set('calendarDate', range.from); next.set('day', range.from); }
      return next;
    });
  }

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (locationInput.trim() !== filterLocation) quickPeriodChange.current = null;
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
    quickPeriodChange.current = null;
    if (unitId && typeof window !== 'undefined') {
      try { window.sessionStorage.removeItem(`agenda_filters_${unitId}`); } catch { /* Filters also live in the URL. */ }
    }
    setParams(previous => {
      const next = new URLSearchParams();
      for (const key of ['view', 'calendarDate', 'calendarMode', 'day', 'order']) {
        if (key === 'order' && orderError) continue;
        const value = previous.get(key);
        if (value) next.set(key, value);
      }
      return next;
    });
    setSearch('');
    setLocationInput('');
    setShowAdvanced(false);
  }

  if (!can('appointments.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não possui acesso à agenda." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade para consultar os serviços agendados." />;

  const options = optionsQuery.isError ? undefined : optionsQuery.data;
  const filterValues = { q, status, from, to, teamId, responsibleId, serviceTypeId, location: filterLocation, eligibility: blockedOnly ? 'blocked' : '' };
  const filterNames = { q: 'Busca', status: 'Situação', from: 'Período inicial', to: 'Período final', teamId: 'Equipe', responsibleId: 'Responsável', serviceTypeId: 'Serviço', location: 'Local', eligibility: 'Documentação' };
  const appliedFilters: AppliedFilter[] = (Object.keys(filterValues) as (keyof typeof filterValues)[]).filter(key => filterValues[key]).map(key => ({
    key, label: filterNames[key], value: key === 'status' ? appointmentLabels[status as keyof typeof appointmentLabels] ?? 'Situação indisponível'
      : key === 'teamId' ? options?.teams.find(team => team.id === teamId && team.unitId === unitId)?.name ?? 'Identificação indisponível'
        : key === 'responsibleId' ? options?.responsibles.find(person => person.id === responsibleId)?.name ?? 'Identificação indisponível'
          : key === 'serviceTypeId' ? options?.services.find(service => service.id === serviceTypeId)?.name ?? 'Identificação indisponível'
            : key === 'eligibility' ? 'Com pendências documentais'
              : key === 'from' || key === 'to' ? calendarDate(filterValues[key]) ? formatDate(filterValues[key]) : 'Data inválida' : filterValues[key],
  }));
  const advancedCount = [from, to, teamId, responsibleId, serviceTypeId, filterLocation].filter(Boolean).length;
  const hasDraftChanges = search.trim() !== q || locationInput.trim() !== filterLocation;

  return (
    <div className={`stack ${styles.agendaWorkspace}`}>
      <header className={styles.planningHeader} data-motion-surface>
        <div className={styles.planningCopy}>
          <p className={styles.planningEyebrow}><span aria-hidden="true"><CalendarDays size={16} /></span>Planejamento e atendimento</p>
          <h1>Agenda de serviços</h1>
          <p className={styles.planningDescription}>Organize a equipe, o horário e os participantes de cada serviço. A liberação para executar acontece na PT em campo.</p>
        </div>
        <div className={styles.planningActions}>
            <div className={styles.planningView} role="group" aria-label="Visualização da agenda">
              <button
                type="button"
                className={styles.planningToggle}
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
              >
                <List size={15} aria-hidden="true" /> Lista
              </button>
              <button
                type="button"
                className={styles.planningToggle}
                onClick={() => setView('calendar')}
                aria-pressed={view === 'calendar'}
              >
                <CalendarDays size={15} aria-hidden="true" /> Calendário
              </button>
            </div>
            {can('appointments.write') && (
              <Link className="button button--primary" to="/app/agenda/novo">
                <Plus size={16} aria-hidden="true" />Agendar serviço
              </Link>
            )}
        </div>
      </header>

      <form noValidate className={`panel flex flex-col gap-4 ${styles.filterPanel}`} onSubmit={handleSearchSubmit} role="search" aria-label="Filtros da agenda">
        <div className={`grid items-end gap-3 ${can('eligibility.read') ? 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]' : 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'}`}>
          <Field label="Buscar atendimento">
            <div className="relative"><Search size={16} className="pointer-events-none absolute left-3.5 top-3.5 text-slate-400" aria-hidden="true" /><input
              ref={searchRef}
              className="!pl-10"
              maxLength={200}
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Código, serviço, equipe, responsável ou local"
            /></div>
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

        <AgendaPeriodControls from={from} to={to} today={today} disabled={!contextReady} onChange={setQuickPeriod} />

        <div className="flex flex-wrap items-end justify-between gap-3"><div className="flex flex-wrap items-center gap-2">
          <Button type="submit"><Search size={14} aria-hidden="true" />Pesquisar</Button>
          {(filtered || hasDraftChanges || orderError) && <Button variant="ghost" onClick={clearFilters}>Limpar filtros</Button>}
          {hasDraftChanges && <span className="text-[11px] leading-5 text-amber-700">Busca ou local ainda não aplicados à lista.</span>}
        </div><div className="w-full sm:w-56"><Field label="Ordenar atendimentos" error={orderError}><select value={orderError ? '' : order} disabled={!contextReady} onChange={event => change('order', event.target.value === 'START_ASC' ? '' : event.target.value)}>{orderError && <option value="">Selecione uma ordenação</option>}{Object.entries(agendaOrderLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field></div></div>
        <FilterDisclosure open={showAdvanced} onOpenChange={setShowAdvanced} count={advancedCount} label="Filtros avançados">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Período inicial (de)" error={fromError}>
                <input
                  type="date"
                  value={from}
                  onChange={event => change('from', event.target.value)}
                  aria-label="Data inicial do filtro"
                />
              </Field>
              <Field label="Período final (até)" error={toError}>
                <input
                  type="date"
                  value={to}
                  min={calendarDate(from)}
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
        </FilterDisclosure>
        <AppliedFilters filters={appliedFilters} onRemove={removeFilter} />
        <p className="!m-0 flex items-center gap-1.5 text-[10px] leading-5 text-slate-500"><Clock3 size={12} aria-hidden="true" />Horários no fuso de Brasília (America/Sao_Paulo)</p>
      </form>

      <motion.div ref={resultsRef} data-agenda-results data-motion-managed className={styles.motionArea} initial={false} animate={resultsMotion} onFocusCapture={settleResults} onPointerDownCapture={settleResults}>
      {periodError || orderError ? (
        <div className="panel stack"><Feedback tone="warning">{periodError ? 'Confira as datas do período para consultar a agenda.' : orderError}</Feedback><EmptyState title="Corrija os filtros da agenda" description={periodError ? 'A consulta será realizada depois de informar um período válido.' : 'Escolha uma ordenação válida para consultar os atendimentos.'} /></div>
      ) : !contextReady || appointments.isPending ? (
        <Spinner />
      ) : appointments.isError ? (
        <div className="panel stack">
          <Feedback tone="danger">{errorMessage(appointments.error)}</Feedback>
          <Button variant="secondary" onClick={() => void appointments.refetch()}>Tentar novamente</Button>
        </div>
      ) : view === 'calendar' ? (
        <AgendaCalendarView
          appointments={orderedAppointments}
          searchString={location.search}
          initialDate={from || (appointments.data?.[0] ? appointmentDateOnly(appointments.data[0].startsAt) : undefined)}
        />
      ) : !appointments.data?.length ? (
        <EmptyState
          title={filtered ? 'Nenhum atendimento encontrado' : 'Nenhum serviço agendado'}
          description={filtered ? 'Ajuste a pesquisa ou limpe os filtros para encontrar outros registros.' : 'Agende um serviço para organizar o próximo atendimento da equipe.'}
        />
      ) : (
          <section aria-label="Resultados da agenda" aria-busy={appointments.isFetching} className={styles.resultsPanel}>
            <div className={styles.resultsHeading}>
              <div><span className={styles.resultsIcon} aria-hidden="true"><CalendarDays size={18} /></span><h2>Atendimentos da unidade</h2></div>
              <p role="status">{appointments.isFetching ? 'Atualizando agenda…' : `${appointments.data.length} atendimento(s) encontrado(s)`}</p>
            </div>
            <AgendaList appointments={orderedAppointments} searchString={location.search} canReadPermits={can('permits.read')} />
          </section>
      )}
      </motion.div>
    </div>
  );
}
