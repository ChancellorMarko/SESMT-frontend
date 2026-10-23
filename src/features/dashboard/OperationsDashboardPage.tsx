import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import { ArrowUpRight, CalendarDays, CalendarClock, FileSearch, Layers3, SlidersHorizontal } from 'lucide-react';
import { useSession } from '../../shared/auth/SessionProvider';
import { Badge, Button, EmptyState, Feedback, Field, Spinner } from '../../shared/ui';
import { TerminologyHelp } from '../../shared/ui/TerminologyGuide';
import { SafetyOverview, getSafetyArea } from './SafetyOverview';
import { InspectionDashboard } from './InspectionDashboard';
import { HealthDashboard } from './HealthDashboard';
import { EquipmentDashboard } from './EquipmentDashboard';
import { DashboardHero } from './DashboardHero';
import { isCivilDate } from '../documents/validation';
import { scopedQueryError } from '../../shared/lib/scoped-page';
import { checkedOperationsDashboard, checkedOperationsOptions } from './operations-response';
import { useDashboardQuery } from './use-dashboard-query';
import styles from './OperationsDashboardPage.module.css';

const appointmentLabels = {
  REQUESTED: 'Solicitado', CONFIRMED: 'Confirmado', ATTENDANCE_OPENED: 'Atendimento aberto', CANCELED: 'Cancelado',
};
const areaContent = {
  inspecoes: { title: 'Inspeções de segurança', description: 'Dos achados em campo à verificação das correções. Organize o próximo passo de cada vistoria.', action: 'Consultar agenda de inspeções', to: '/app/agenda?q=Inspeção', permission: 'appointments.read' },
  saude: { title: 'Saúde ocupacional e capacitações', description: 'Atestados de saúde ocupacional (ASO) e capacitações: espaços próprios para acompanhar documentos e planejar cada rotina.', action: 'Consultar vencimentos', to: '/app/vencimentos', permission: 'documents.read' },
  epis: { title: 'Equipamentos de proteção', description: 'Equipamentos de proteção individual (EPI): planeje entregas, confira comprovantes e acompanhe o que precisa de atenção.', action: 'Consultar documentos de EPIs', to: '/app/documentos?q=EPI', permission: 'documents.read' },
};

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
  const [params] = useSearchParams();
  const area = getSafetyArea(params.get('area'));

  if (!area) return <GeneralOperationsDashboard />;
  if (!s.can('appointments.read')) return <Feedback tone="warning">Seu acesso não permite consultar o painel operacional.</Feedback>;
  if (!s.unitId) return <EmptyState title="Selecione uma unidade" description="Escolha uma unidade de trabalho para consultar o painel operacional." />;

  const content = areaContent[area];
  return <div className={styles.page} key={`${s.sessionKey}:${s.unitId}:${area}`}>
    <DashboardHero variant={area} title={content.title} description={content.description} back action={s.can(content.permission) ? { label: content.action, to: content.to } : undefined} />
    {area === 'saude' && <div className="actions"><TerminologyHelp related={['ASO', 'NR']}>Entenda ASO e NR</TerminologyHelp></div>}
    {area === 'epis' && <div className="actions"><TerminologyHelp related={['EPI']}>O que significa EPI?</TerminologyHelp></div>}
    {area === 'inspecoes' ? <InspectionDashboard can={s.can} /> : area === 'saude' ? <HealthDashboard can={s.can} /> : <EquipmentDashboard can={s.can} />}
  </div>;
}

function GeneralOperationsDashboard() {
  const s = useSession();
  const navigate = useNavigate();
  const reduce = useAppReducedMotion();
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
  const reveal = (delay = 0) => ({
    initial: reduce ? false as const : { opacity: 0, y: 24, filter: 'blur(4px)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    transition: { duration: reduce ? 0 : .6, delay: reduce ? 0 : delay, ease: [.22, 1, .36, 1] as const },
  });
  function clearFilters() { setFilterFrom(''); setFilterTo(''); setFilterTeamId(''); setFilterServiceId(''); setFilterLocation(''); }

  if (!permitted) return <Feedback tone="warning">Seu acesso não permite consultar o painel operacional.</Feedback>;
  if (!s.unitId) return <EmptyState title="Selecione uma unidade" description="Escolha uma unidade de trabalho para consultar o painel operacional." />;

  return <div className={styles.page}>
    <DashboardHero variant="overview" title="Visão geral" description={`Olá${greeting ? `, ${greeting}` : ''}. Vamos cuidar de quem faz a operação acontecer.`} action={s.can('appointments.write') ? { label: 'Agendar serviço', to: '/app/agenda/novo' } : undefined} />

    <SafetyOverview key={`${s.sessionKey}:${s.unitId}`} canReadDocuments={s.can('documents.read')} />

    <motion.section {...reveal(.08)} className={styles.operation} aria-label="Operação da unidade selecionada">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.sectionLabel}><Layers3 size={12} aria-hidden="true" />OPERAÇÃO DA UNIDADE SELECIONADA</span>
          <h2>O trabalho, em movimento</h2>
          <p>Agenda, permissões e pendências consultadas no escopo do seu acesso.</p>
        </div>
        {validFilters && !invalidSelection && !options.isError && !dashboard.isError && <Link to={agendaPath} className={styles.sectionLink}>Consultar agenda<ArrowUpRight size={15} aria-hidden="true" /></Link>}
      </div>

      {dashboard.data && !dashboard.isError && <div className={styles.metrics}>
        {[
          { label: 'Serviços na agenda', value: dashboard.data.appointments, help: 'Não cancelados · abrir agenda completa', to: agendaPath, visible: true, icon: CalendarDays },
          { label: 'Permissões em atendimento', value: dashboard.data.activePermits, help: 'Permissões de trabalho (PT) · unidade e equipe selecionadas', to: permitsPath, visible: s.can('permits.read'), icon: FileSearch },
          { label: 'Pendências documentais', value: dashboard.data.blockedAppointments, help: 'Solicitados ou confirmados com requisito pendente', to: blockedAgendaPath, visible: s.can('eligibility.read'), icon: Layers3 },
          { label: 'Encerramentos para revisão', value: dashboard.data.pendingReviews, help: 'PTs aguardando validação final', to: pendingReviewsPath, visible: s.can('permits.read'), icon: CalendarClock },
        ].filter(metric => metric.visible).map((metric, index) => <motion.div {...reveal(index * .08)} whileHover={reduce ? undefined : { y: -7, scale: 1.015 }} className={styles.metricSlot} key={metric.label}>
          <Link className={styles.metric} to={metric.to}>
            <span className={styles.metricTop}>{metric.label}<ArrowUpRight size={13} aria-hidden="true" /></span>
            <span className={styles.metricValue}><span className={styles.metricIcon}><metric.icon size={15} aria-hidden="true" /></span><strong>{metric.value.toLocaleString('pt-BR')}</strong></span>
            <small>{metric.help}</small>
          </Link>
        </motion.div>)}
      </div>}

      <div className={styles.queryPanel}>
        <form className={styles.searchForm} onSubmit={event => {
          event.preventDefault();
          if (!canSearch) return;
          const paths: Record<string, string> = {
            agenda: filteredPath('/app/agenda', { ...agendaFilters, q: search.trim() }),
            pts: filteredPath('/app/pts', { ...permitFilters, q: search.trim() }),
            documentos: filteredPath('/app/documentos', { q: search.trim() }),
          };
          navigate(paths[searchCategory]);
        }}>
          <div><Field label="Pesquisar na plataforma"><input placeholder="Código, serviço, local ou título…" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></Field></div>
          <div><Field label="Pesquisar em"><select value={searchCategory} onChange={event => setCategory(event.target.value)}><option value="agenda">Agendamentos</option>{s.can('permits.read') && <option value="pts">Permissões de trabalho</option>}{s.can('documents.read') && <option value="documentos">Documentos</option>}</select></Field></div>
          <Button type="submit" disabled={!canSearch}><FileSearch size={16} aria-hidden="true" />Pesquisar</Button>
        </form>

        <section className={styles.filters} aria-label="Filtros contextuais do painel">
          <div className={styles.filterHeader}>
            <div className={styles.filterTitle}><SlidersHorizontal size={15} aria-hidden="true" /><h3>Filtros contextuais do painel</h3></div>
            <div className="actions">{hasOperationalFilters && <><Badge tone="info">Filtros ativos</Badge><Button type="button" variant="ghost" onClick={clearFilters}>Limpar filtros</Button></>}<Button variant="secondary" disabled={!enabled || dashboard.isFetching || dashboard.isError} onClick={() => void dashboard.retry()}>Atualizar painel</Button></div>
          </div>
          <div className={styles.filterFields}>
            <Field label="Período de início" error={fromError}><input type="date" value={filterFrom} onChange={event => setFilterFrom(event.target.value)} /></Field>
            <Field label="Período até" error={toError}><input type="date" value={filterTo} onChange={event => setFilterTo(event.target.value)} /></Field>
            {options.data && options.data.teams.length > 0 && <Field label="Equipe operacional"><select value={filterTeamId} disabled={options.isFetching} onChange={event => setFilterTeamId(event.target.value)}><option value="">Todas as equipes</option>{options.data.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></Field>}
            {options.data && options.data.services.length > 0 && <Field label="Tipo de serviço"><select value={filterServiceId} disabled={options.isFetching} onChange={event => setFilterServiceId(event.target.value)}><option value="">Todos os serviços</option>{options.data.services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field>}
            <Field label="Local / Área" error={locationError}><input type="text" maxLength={200} placeholder="Ex.: Silo, Britador, Pátio" value={filterLocation} onChange={event => setFilterLocation(event.target.value)} /></Field>
          </div>
        </section>
      </div>

      {!validFilters && <Feedback tone="warning">Corrija os filtros ou limpe a seleção para consultar os indicadores operacionais.</Feedback>}
      {invalidSelection && <Feedback tone="warning">A equipe ou o serviço selecionado não está disponível nas referências atuais. Limpe os filtros e selecione novamente.</Feedback>}
      {options.isError && <Feedback tone="danger">{scopedQueryError(options.error, 'referências do painel')} <Button variant="ghost" disabled={options.isFetching} onClick={() => void options.retry()}>Tentar carregar filtros</Button></Feedback>}

      <div className={styles.quickLinks}>
        {s.can('eligibility.read') && !options.isError && !invalidSelection && Boolean(!(filterTeamId || filterServiceId) || options.data) && <Link className={styles.quickLink} to={readinessPath}><FileSearch size={17} aria-hidden="true" />Conferir requisitos por participante<ArrowUpRight size={15} aria-hidden="true" /></Link>}
        {s.can('documents.read') && <Link className={styles.quickLink} to="/app/vencimentos"><CalendarClock size={17} aria-hidden="true" />Planejar renovações e consultar vencimentos<ArrowUpRight size={15} aria-hidden="true" /></Link>}
      </div>
      {dashboard.isPending && <Spinner />}
      {dashboard.isError && <Feedback tone="danger">{scopedQueryError(dashboard.error, 'painel operacional')} <Button variant="ghost" disabled={dashboard.isFetching} onClick={() => void dashboard.retry()}>Tentar novamente</Button></Feedback>}

      {dashboard.data && !dashboard.isError && <>
        <div className={`${styles.queues} ${s.can('permits.read') ? '' : styles.queuesSingle}`}>
          <section className={styles.queue}>
            <div className={styles.queueHeader}>
              <div><h2>Próximos serviços</h2><p>Programação e responsáveis</p></div>
              <Link to={agendaPath}>Ver agenda →</Link>
            </div>
            {dashboard.data.nextAppointments.length ? <div>{dashboard.data.nextAppointments.map(item => <Link className={styles.appointment} key={item.id} to={`/app/agenda/${item.id}`}>
              <div className={styles.appointmentTime}>{dateTime(item.startsAt)}</div>
              <div className={styles.appointmentBody}><strong>{item.serviceLabel}</strong><p>{item.location} · {item.teamName}</p><small>{item.code} · {item.responsibleName}</small></div>
              <span><Badge tone={item.status === 'CONFIRMED' ? 'success' : 'neutral'}>{appointmentLabels[item.status]}</Badge></span>
            </Link>)}</div> : <EmptyState title="Sem serviços na agenda" description="Os próximos serviços aparecerão aqui conforme os filtros e o seu acesso." />}
          </section>
          {s.can('permits.read') && <section className={styles.queue}>
            <div className={styles.queueHeader}>
              <div><h2>Revisão e correções</h2><p>Encerramentos que precisam de acompanhamento</p></div>
              <Link to={permitsPath}>Ver PTs →</Link>
            </div>
            {dashboard.data.pendingPermits.length ? dashboard.data.pendingPermits.map(item => <Link key={item.id} to={`/app/pts/${item.id}`} className={styles.review}>
              <strong>{item.code}</strong>
              <Badge tone={item.reviewStatus === 'RETURNED' ? 'warning' : 'info'}>{item.reviewStatus === 'RETURNED' ? 'Devolvida para correção' : 'Aguardando revisão'}</Badge>
              <span>{item.appointment.serviceLabel} · {item.appointment.location}</span>
              <small>Operação concluída · versão {item.version}</small>
            </Link>) : <EmptyState title="Nenhuma revisão pendente" description="A fila acompanha apenas as PTs do seu escopo para este filtro." />}
            {s.can('dashboard.read') && <Link className={styles.queueFooter} to="/app/painel-documental"><FileSearch size={16} aria-hidden="true" />Consultar painel documental<ArrowUpRight size={14} aria-hidden="true" /></Link>}
          </section>}
        </div>
        <p className={styles.updated}>Atualizado em {dateTime(dashboard.data.generatedAt)} · Horários de Brasília (America/Sao_Paulo).</p>
      </>}
      <Feedback>O atendimento aberto inicia a conferência. A execução depende da liberação por responsável designado e dos requisitos atendidos.</Feedback>
    </motion.section>
  </div>;
}
