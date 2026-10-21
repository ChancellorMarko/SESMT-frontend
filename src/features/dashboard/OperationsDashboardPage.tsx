import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, CalendarDays, CalendarClock, FileSearch, Layers3, SlidersHorizontal } from 'lucide-react';
import { useSession } from '../../shared/auth/SessionProvider';
import { Badge, Button, EmptyState, Feedback, Field, Spinner } from '../../shared/ui';
import { SafetyOverview, getSafetyArea } from './SafetyOverview';
import { isCivilDate } from '../documents/validation';
import { scopedQueryError } from '../../shared/lib/scoped-page';
import { checkedOperationsDashboard, checkedOperationsOptions } from './operations-response';
import { useDashboardQuery } from './use-dashboard-query';

const appointmentLabels = {
  REQUESTED: 'Solicitado', CONFIRMED: 'Confirmado', ATTENDANCE_OPENED: 'Atendimento aberto', CANCELED: 'Cancelado',
};
const areaTitles = { inspecoes: 'Inspeções de segurança', saude: 'Saúde e capacitação', epis: 'Equipamentos de proteção' };

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(value));
}

function filteredPath(path: string, filters: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
  return query.size ? `${path}?${query}` : path;
}

export function OperationsDashboardPage() {
  const s = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const area = getSafetyArea(params.get('area'));
  const reduce = useReducedMotion();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('agenda');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const teamContext = JSON.stringify([s.sessionKey, s.unitId]);
  const [teamFilter, setTeamFilter] = useState({ context: teamContext, value: '' });
  // Derive the empty selection immediately so a context change cannot query or link the previous team's scope.
  const filterTeamId = teamFilter.context === teamContext ? teamFilter.value : '';
  useEffect(() => {
    setTeamFilter(current => current.context === teamContext ? current : { context: teamContext, value: '' });
  }, [teamContext]);
  function setFilterTeamId(value: string) { setTeamFilter({ context: teamContext, value }); }
  const [filterServiceId, setFilterServiceId] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const permitted = s.can('appointments.read');
  const fromError = filterFrom && !isCivilDate(filterFrom) ? 'Informe uma data inicial válida.' : undefined;
  const toError = filterTo && !isCivilDate(filterTo) ? 'Informe uma data final válida.'
    : filterFrom && filterTo && filterFrom > filterTo ? 'A data final deve ser igual ou posterior à inicial.' : undefined;
  const locationError = filterLocation.length > 200 || /[\u0000-\u001f\u007f]/.test(filterLocation) ? 'Use até 200 caracteres, sem controles, para o local.' : undefined;
  const validFilters = !fromError && !toError && !locationError;
  const hasOperationalFilters = Boolean(filterFrom || filterTo || filterTeamId || filterServiceId || filterLocation);
  const agendaFilters = { from: filterFrom, to: filterTo, teamId: filterTeamId, serviceTypeId: filterServiceId, location: filterLocation.trim() };
  // Each destination receives only the criteria its existing list supports.
  const permitFilters = { unitId: s.unitId, teamId: filterTeamId };
  const agendaPath = filteredPath('/app/agenda', agendaFilters);
  const blockedAgendaPath = filteredPath('/app/agenda', { ...agendaFilters, eligibility: 'blocked' });
  const permitsPath = filteredPath('/app/pts', permitFilters);
  const pendingReviewsPath = filteredPath('/app/pts', { ...permitFilters, reviewStatus: 'PENDING_REVIEW' });
  const readinessPath = filteredPath('/app/pendencias', { unitId: s.unitId, teamId: filterTeamId, serviceTypeId: filterServiceId, status: 'pending' });

  const checkOptions = useCallback((value: unknown) => checkedOperationsOptions(value, s.unitId ?? ''), [s.unitId]);
  const options = useDashboardQuery({
    resource: 'permit-options', sessionKey: s.sessionKey, unitId: s.unitId,
    query: { unitId: s.unitId }, check: checkOptions, enabled: permitted && Boolean(s.unitId),
  });
  const invalidSelection = Boolean(options.data && (filterTeamId && !options.data.teams.some(team => team.id === filterTeamId)
    || filterServiceId && !options.data.services.some(service => service.id === filterServiceId)));
  const enabled = permitted && Boolean(s.unitId) && validFilters && !invalidSelection && !options.isError
    && Boolean(!(filterTeamId || filterServiceId) || options.data);
  const checkDashboard = useCallback((value: unknown) => checkedOperationsDashboard(value, {
    unitId: s.unitId ?? '', from: filterFrom, to: filterTo, teamId: filterTeamId, serviceId: filterServiceId, location: filterLocation,
  }), [s.unitId, filterFrom, filterTo, filterTeamId, filterServiceId, filterLocation]);
  const dashboard = useDashboardQuery({
    resource: 'permit-dashboard', sessionKey: s.sessionKey, unitId: s.unitId,
    blockedBy: options.isError ? options.error : undefined,
    criteria: [filterFrom, filterTo, filterTeamId, filterServiceId, filterLocation], check: checkDashboard, enabled,
    query: { unitId: s.unitId, from: filterFrom || undefined, to: filterTo || undefined, teamId: filterTeamId || undefined, serviceId: filterServiceId || undefined, location: filterLocation.trim() || undefined },
  });
  // Derive an available destination immediately if the user's capabilities change.
  const searchCategory = category === 'pts' && s.can('permits.read') ? 'pts'
    : category === 'documentos' && s.can('documents.read') ? 'documentos' : 'agenda';
  const canSearch = searchCategory === 'documentos' ? s.can('documents.read')
    : searchCategory === 'pts' ? !options.isError && !invalidSelection && Boolean(!filterTeamId || options.data) : enabled && !dashboard.isError;
  const greeting = s.me?.user.displayName.split(' ')[0];
  function clearFilters() { setFilterFrom(''); setFilterTo(''); setFilterTeamId(''); setFilterServiceId(''); setFilterLocation(''); }

  if (!permitted) return <Feedback tone="warning">Seu acesso não permite consultar o painel operacional.</Feedback>;
  if (!s.unitId) return <EmptyState title="Selecione uma unidade" description="Escolha uma unidade de trabalho para consultar o painel operacional." />;

  return <div className="space-y-6 sm:space-y-8">
    <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4 }} className="flex flex-wrap items-end justify-between gap-5 pt-1">
      <div><p className="mt-0 mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.17em] text-[#7e91a8]"><span className="h-px w-6 bg-[#91a8c0]" />SEU ESPAÇO DE SEGURANÇA</p><h1 className="m-0 text-[30px] font-semibold leading-tight tracking-[-.045em] text-[#183b68] sm:text-[34px]">{area ? areaTitles[area] : 'Visão geral'}<span aria-hidden="true" className="text-[#91a8c0]">.</span></h1><p className="mt-3 mb-0 text-[12px] leading-6 text-slate-500">Olá, <span className="font-medium text-[#496683]">{greeting}</span>. Vamos cuidar de quem faz a operação acontecer.</p></div>
      {s.can('appointments.write') && <Link className="button button--primary" to="/app/agenda/novo"><CalendarDays size={16} />Agendar serviço<ArrowUpRight size={14} /></Link>}
    </motion.div>

    <SafetyOverview key={`${s.sessionKey}:${s.unitId}`} canReadDocuments={s.can('documents.read')} />

    <section className="space-y-5" aria-label="Operação da unidade selecionada">
      <div className="flex flex-wrap items-end justify-between gap-4 border-t border-[#dce4ee] pt-8"><div><p className="mt-0 mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.15em] text-[#8497ad]"><Layers3 size={12} aria-hidden="true" />OPERAÇÃO DA UNIDADE SELECIONADA</p><h2 className="m-0 text-[22px] font-semibold tracking-[-.035em] text-[#183b68]">O trabalho, em movimento</h2><p className="mt-2 mb-0 text-[12px] leading-6 text-slate-500">Agenda, permissões e pendências consultadas no escopo do seu acesso.</p></div>{validFilters && !invalidSelection && !options.isError && !dashboard.isError && <Link to={agendaPath} className="inline-flex min-h-10 items-center gap-2 text-[11px] font-semibold text-[#44698f]">Consultar agenda<ArrowUpRight size={15} aria-hidden="true" /></Link>}</div>

      {dashboard.data && !dashboard.isError && <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'Serviços na agenda', value: dashboard.data.appointments, help: 'Não cancelados · abrir agenda completa', to: agendaPath, visible: true },
          { label: 'PTs em atendimento', value: dashboard.data.activePermits, help: 'Em atendimento · abrir lista completa da unidade e equipe', to: permitsPath, visible: s.can('permits.read') },
          { label: 'Pendências documentais', value: dashboard.data.blockedAppointments, help: 'Solicitados ou confirmados com requisito pendente', to: blockedAgendaPath, visible: s.can('eligibility.read') },
          { label: 'Encerramentos para revisão', value: dashboard.data.pendingReviews, help: 'PTs aguardando validação final', to: pendingReviewsPath, visible: s.can('permits.read') },
        ].filter(metric => metric.visible).map(metric => <Link className="group flex min-w-0 flex-col gap-2 rounded-2xl sm:gap-3 border border-white/90 bg-white/70 p-3.5 text-inherit sm:p-5 no-underline transition-colors hover:bg-white" to={metric.to} key={metric.label}><span className="flex items-start justify-between gap-1.5 text-[11px] font-medium leading-5 text-slate-500">{metric.label}<ArrowUpRight size={13} className="mt-1 shrink-0 text-slate-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" /></span><strong className="text-[29px] font-semibold leading-none tracking-[-.04em] text-[#315884]">{metric.value.toLocaleString('pt-BR')}</strong><small className="mt-auto text-[10px] leading-5 text-slate-400">{metric.help}</small></Link>)}
      </div>}

      <form className="flex flex-col items-stretch gap-3 rounded-3xl border border-white bg-white/80 p-4 md:flex-row md:items-end md:p-5" onSubmit={event => { event.preventDefault(); if (!canSearch) return; const paths: Record<string, string> = { agenda: filteredPath('/app/agenda', { ...agendaFilters, q: search.trim() }), pts: filteredPath('/app/pts', { ...permitFilters, q: search.trim() }), documentos: filteredPath('/app/documentos', { q: search.trim() }) }; navigate(paths[searchCategory]); }}>
        <div className="min-w-0 flex-1"><Field label="Pesquisar na plataforma"><input placeholder="Código, serviço, local ou título…" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></Field></div>
        <div className="md:w-56"><Field label="Pesquisar em"><select value={searchCategory} onChange={event => setCategory(event.target.value)}><option value="agenda">Agendamentos</option>{s.can('permits.read') && <option value="pts">Permissões de trabalho</option>}{s.can('documents.read') && <option value="documentos">Documentos</option>}</select></Field></div>
        <Button type="submit" disabled={!canSearch}><FileSearch size={16} />Pesquisar</Button>
      </form>

      <section className="space-y-4 rounded-3xl border border-white bg-white/65 p-4 sm:p-5" aria-label="Filtros contextuais do painel">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-[#8497ad]"><SlidersHorizontal size={15} aria-hidden="true" /><h3 className="m-0 text-[11px] font-semibold text-[#496683]">Filtros contextuais do painel</h3></div><div className="actions">{hasOperationalFilters && <><Badge tone="info">Filtros ativos</Badge><Button type="button" variant="ghost" onClick={clearFilters}>Limpar filtros</Button></>}<Button variant="secondary" disabled={!enabled || dashboard.isFetching || dashboard.isError} onClick={() => void dashboard.retry()}>Atualizar painel</Button></div></div>
        <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Field label="Período de início" error={fromError}><input type="date" value={filterFrom} onChange={event => setFilterFrom(event.target.value)} /></Field>
          <Field label="Período até" error={toError}><input type="date" value={filterTo} onChange={event => setFilterTo(event.target.value)} /></Field>
          {options.data && options.data.teams.length > 0 && <Field label="Equipe operacional"><select value={filterTeamId} disabled={options.isFetching} onChange={event => setFilterTeamId(event.target.value)}><option value="">Todas as equipes</option>{options.data.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></Field>}
          {options.data && options.data.services.length > 0 && <Field label="Tipo de serviço"><select value={filterServiceId} disabled={options.isFetching} onChange={event => setFilterServiceId(event.target.value)}><option value="">Todos os serviços</option>{options.data.services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field>}
          <Field label="Local / Área" error={locationError}><input type="text" maxLength={200} placeholder="Ex.: Silo, Britador, Pátio" value={filterLocation} onChange={event => setFilterLocation(event.target.value)} /></Field>
        </div>
      </section>

      {!validFilters && <Feedback tone="warning">Corrija os filtros ou limpe a seleção para consultar os indicadores operacionais.</Feedback>}
      {invalidSelection && <Feedback tone="warning">A equipe ou o serviço selecionado não está disponível nas referências atuais. Limpe os filtros e selecione novamente.</Feedback>}
      {options.isError && <Feedback tone="danger">{scopedQueryError(options.error, 'referências do painel')} <Button variant="ghost" disabled={options.isFetching} onClick={() => void options.retry()}>Tentar carregar filtros</Button></Feedback>}

      {s.can('eligibility.read') && !options.isError && !invalidSelection && Boolean(!(filterTeamId || filterServiceId) || options.data) && <Link className="flex min-h-12 items-center gap-3 rounded-2xl border border-[#dce5ef] bg-white/65 px-4 py-3 text-[11px] font-medium leading-5 text-[#496c92] no-underline transition-colors hover:bg-white" to={readinessPath}><FileSearch size={17} className="shrink-0" aria-hidden="true" />Conferir requisitos por participante<ArrowUpRight size={15} className="ml-auto shrink-0" aria-hidden="true" /></Link>}

      {s.can('documents.read') && <Link className="flex min-h-12 items-center gap-3 rounded-2xl border border-[#dce5ef] bg-[#e8eef6]/65 px-4 py-3 text-[11px] font-medium leading-5 text-[#496c92] no-underline transition-colors hover:bg-[#e3ebf5]" to="/app/vencimentos"><CalendarClock size={17} className="shrink-0" aria-hidden="true" />Planejar renovações e consultar vencimentos<ArrowUpRight size={15} className="ml-auto shrink-0" aria-hidden="true" /></Link>}
      {dashboard.isPending && <Spinner />}
      {dashboard.isError && <Feedback tone="danger">{scopedQueryError(dashboard.error, 'painel operacional')} <Button variant="ghost" disabled={dashboard.isFetching} onClick={() => void dashboard.retry()}>Tentar novamente</Button></Feedback>}

      {dashboard.data && !dashboard.isError && <>
        <div className={`grid items-start gap-5 ${s.can('permits.read') ? 'xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]' : ''}`}>
          <section className="overflow-hidden rounded-3xl border border-white bg-white/85">
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-6"><div><h2 className="m-0 text-[15px] font-semibold text-[#315884]">Próximos serviços</h2><p className="mt-2 mb-0 text-[11px] text-slate-400">Programação e responsáveis</p></div><Link to={agendaPath} className="shrink-0 text-[10px] font-semibold text-[#54799e] no-underline">Ver agenda →</Link></div>
            {dashboard.data.nextAppointments.length ? <div className="flex flex-col">{dashboard.data.nextAppointments.map(item => <Link className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 border-b border-slate-100 px-5 py-5 text-inherit no-underline transition-colors last:border-0 hover:bg-[#f5f8fc] sm:grid-cols-[80px_minmax(0,1fr)_auto]" key={item.id} to={`/app/agenda/${item.id}`}><div className="row-span-2 flex self-stretch items-center border-r border-slate-100 pr-3 text-[10px] font-medium leading-5 text-[#8497ad] sm:row-span-1">{dateTime(item.startsAt)}</div><div className="min-w-0 break-words"><strong className="text-[12px] font-semibold leading-5 text-[#496683]">{item.serviceLabel}</strong><p className="my-1 text-[11px] leading-5 text-slate-500">{item.location} · {item.teamName}</p><small className="text-[10px] leading-5 text-slate-400">{item.code} · {item.responsibleName}</small></div><div className="col-start-2 justify-self-start sm:col-start-auto"><Badge tone={item.status === 'CONFIRMED' ? 'success' : 'neutral'}>{appointmentLabels[item.status]}</Badge></div></Link>)}</div> : <EmptyState title="Sem serviços na agenda" description="Os próximos serviços aparecerão aqui conforme os filtros e o seu acesso." />}
          </section>
          {s.can('permits.read') && <section className="overflow-hidden rounded-3xl border border-white bg-white/85">
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-6"><div><h2 className="m-0 text-[15px] font-semibold text-[#315884]">Revisão e correções</h2><p className="mt-2 mb-0 text-[11px] leading-5 text-slate-400">Encerramentos que precisam de acompanhamento</p></div><Link to={permitsPath} className="shrink-0 text-[10px] font-semibold text-[#54799e] no-underline">Ver PTs →</Link></div>
            {dashboard.data.pendingPermits.length ? dashboard.data.pendingPermits.map(item => <Link key={item.id} to={`/app/pts/${item.id}`} className="flex flex-col items-start gap-2 border-b border-slate-100 px-5 py-5 text-inherit no-underline transition-colors hover:bg-[#f5f8fc]"><Badge tone={item.reviewStatus === 'RETURNED' ? 'warning' : 'info'}>{item.reviewStatus === 'RETURNED' ? 'Devolvida para correção' : 'Aguardando revisão'}</Badge><strong className="text-[12px] font-semibold text-[#496683]">{item.code}</strong><span className="text-[11px] leading-5 text-slate-500">{item.appointment.serviceLabel} · {item.appointment.location}</span><small className="text-[10px] text-slate-400">Operação concluída · versão {item.version}</small></Link>) : <EmptyState title="Nenhuma revisão pendente" description="A fila acompanha apenas as PTs do seu escopo para este filtro." />}
            {s.can('dashboard.read') && <Link className="flex items-center gap-2 px-5 py-5 text-[11px] font-medium text-[#54799e] no-underline hover:bg-[#f5f8fc]" to="/app/painel-documental"><FileSearch size={16} />Consultar painel documental<ArrowUpRight size={14} className="ml-auto" /></Link>}
          </section>}
        </div>
        <p className="my-0 text-[10px] leading-5 text-slate-400">Atualizado em {dateTime(dashboard.data.generatedAt)} · Horários de Brasília (America/Sao_Paulo).</p>
      </>}
      <Feedback>O atendimento aberto inicia a conferência. A execução depende da liberação por responsável designado e dos requisitos atendidos.</Feedback>
    </section>
  </div>;
}
