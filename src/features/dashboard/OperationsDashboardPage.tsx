import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  CalendarDays,
  CalendarClock,
  ClipboardCheck,
  FileSearch,
  ShieldCheck,
  Filter,
} from 'lucide-react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { PermitDashboardDto, PermitOptionsDto } from '../../shared/contracts/work-permits';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import styles from './operations.module.css';

const appointmentLabels = {
  REQUESTED: 'Solicitado',
  CONFIRMED: 'Confirmado',
  ATTENDANCE_OPENED: 'Atendimento aberto',
  CANCELED: 'Cancelado',
};

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

export function OperationsDashboardPage() {
  const s = useSession();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('agenda');

  // Filters state
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterTeamId, setFilterTeamId] = useState('');
  const [filterServiceId, setFilterServiceId] = useState('');
  const [filterLocation, setFilterLocation] = useState('');

  const hasOperationalFilters = Boolean(filterFrom || filterTo || filterTeamId || filterServiceId || filterLocation);

  const options = useQuery({
    queryKey: ['permit-options', s.sessionKey, s.unitId],
    queryFn: ({ signal }) => api.get<PermitOptionsDto>('/permit-options', { query: { unitId: s.unitId }, signal }),
    enabled: s.can('appointments.read') && Boolean(s.unitId),
  });

  const dashboard = useQuery({
    queryKey: [
      'permit-dashboard',
      s.sessionKey,
      s.unitId,
      filterFrom,
      filterTo,
      filterTeamId,
      filterServiceId,
      filterLocation,
    ],
    queryFn: ({ signal }) =>
      api.get<PermitDashboardDto>('/permit-dashboard', {
        query: {
          unitId: s.unitId,
          from: filterFrom || undefined,
          to: filterTo || undefined,
          teamId: filterTeamId || undefined,
          serviceId: filterServiceId || undefined,
          location: filterLocation.trim() || undefined,
        },
        signal,
      }),
    enabled: s.can('appointments.read') && Boolean(s.unitId),
  });

  const greeting = s.me?.user.displayName.split(' ')[0];

  function clearFilters() {
    setFilterFrom('');
    setFilterTo('');
    setFilterTeamId('');
    setFilterServiceId('');
    setFilterLocation('');
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="ROTINA DE SEGURANÇA"
        title="Visão geral"
        description="Agenda, permissões de trabalho e pendências operacionais da unidade selecionada."
        actions={
          s.can('appointments.write') && (
            <Link className="button button--primary" to="/app/agenda/novo">
              <CalendarDays size={16} /> Agendar serviço
            </Link>
          )
        }
      />

      <section className={styles.welcome}>
        <div className={styles.welcomeContent}>
          <span className={styles.welcomeLabel}>
            <ShieldCheck size={15} aria-hidden="true" /> AMPARA SESMT
          </span>
          <h2>
            Olá, {greeting}.<br />
            Cada etapa, no seu tempo.
          </h2>
          <p>Acompanhe o serviço desde o agendamento até a revisão do encerramento.</p>
          <Link to="/app/agenda" className={styles.heroLink}>
            Consultar agenda <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className={styles.process} aria-label="Etapas de uma permissão de trabalho">
          <span><b>01</b> Conferir</span>
          <span><b>02</b> Liberar e executar</span>
          <span><b>03</b> Concluir e revisar</span>
          <ShieldCheck size={68} strokeWidth={1} aria-hidden="true" />
        </div>
      </section>

      {/* Busca rápida */}
      <form
        className={`panel ${styles.search}`}
        onSubmit={e => {
          e.preventDefault();
          const paths: Record<string, string> = {
            agenda: '/app/agenda',
            pts: '/app/pts',
            documentos: '/app/documentos',
          };
          navigate(`${paths[category]}?q=${encodeURIComponent(search.trim())}`);
        }}
      >
        <Field label="Pesquisar na plataforma">
          <input
            placeholder="Código, serviço, local ou título…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </Field>
        <Field label="Pesquisar em">
          <select value={category} onChange={e => setCategory(e.target.value)}>
            <option value="agenda">Agendamentos</option>
            <option value="pts">Permissões de trabalho</option>
            {s.can('documents.read') && <option value="documentos">Documentos</option>}
          </select>
        </Field>
        <Button type="submit">
          <FileSearch size={16} /> Pesquisar
        </Button>
      </form>

      {/* Filtros operacionais do painel */}
      <section className="panel stack" aria-label="Filtros contextuais do painel">
        <div className="toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Filter size={16} aria-hidden="true" />
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Filtros contextuais do painel</h3>
          </div>
          {hasOperationalFilters && (
            <div className="actions">
              <Badge tone="info">Filtros ativos</Badge>
              <Button type="button" variant="ghost" onClick={clearFilters}>
                Limpar filtros
              </Button>
            </div>
          )}
        </div>
        <div className="form-grid">
          <Field label="Período de início">
            <input
              type="date"
              value={filterFrom}
              onChange={e => setFilterFrom(e.target.value)}
            />
          </Field>
          <Field label="Período até">
            <input
              type="date"
              value={filterTo}
              onChange={e => setFilterTo(e.target.value)}
            />
          </Field>
          {options.data && options.data.teams.length > 0 && (
            <Field label="Equipe operacional">
              <select value={filterTeamId} onChange={e => setFilterTeamId(e.target.value)}>
                <option value="">Todas as equipes</option>
                {options.data.teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>
          )}
          {options.data && options.data.services.length > 0 && (
            <Field label="Tipo de serviço">
              <select value={filterServiceId} onChange={e => setFilterServiceId(e.target.value)}>
                <option value="">Todos os serviços</option>
                {options.data.services.map(svc => (
                  <option key={svc.id} value={svc.id}>{svc.name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Local / Área">
            <input
              type="text"
              placeholder="Ex.: Silo, Britador, Pátio"
              value={filterLocation}
              onChange={e => setFilterLocation(e.target.value)}
            />
          </Field>
        </div>
      </section>

      {s.can('documents.read') && (
        <Link className={styles.documentLink} to="/app/vencimentos">
          <CalendarClock size={18} aria-hidden="true" /> Planejar renovações e consultar vencimentos <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      )}

      {dashboard.isPending && s.can('appointments.read') && <Spinner />}
      {dashboard.isError && (
        <Feedback tone="danger">
          {dashboard.error.message}{' '}
          <Button variant="ghost" onClick={() => void dashboard.refetch()}>
            Tentar novamente
          </Button>
        </Feedback>
      )}

      {dashboard.data && !dashboard.isError && (
        <>
          <div className={styles.metrics}>
            {[
              {
                label: 'Serviços na agenda',
                value: dashboard.data.appointments,
                help: 'Agendamentos ainda não cancelados',
                to: '/app/agenda',
                icon: CalendarDays,
                tone: 'blue' as const,
              },
              {
                label: 'PTs em atendimento',
                value: dashboard.data.activePermits,
                help: 'Conferência, liberação, execução ou suspensão',
                to: '/app/pts',
                icon: ClipboardCheck,
                tone: 'teal' as const,
              },
              {
                label: 'Pendências documentais',
                value: dashboard.data.blockedAppointments,
                help: 'Agendamentos com requisito pendente',
                to: '/app/pendencias?status=pending',
                icon: FileSearch,
                tone: 'amber' as const,
              },
              {
                label: 'Encerramentos para revisão',
                value: dashboard.data.pendingReviews,
                help: 'PTs aguardando validação final',
                to: '/app/pts?reviewStatus=PENDING_REVIEW',
                icon: ShieldCheck,
                tone: 'coral' as const,
              },
            ].map(metric => (
              <Link className={`panel ${styles.metric}`} to={metric.to} key={metric.label}>
                <div>
                  <span className={`${styles.metricIcon} ${styles[metric.tone]}`}>
                    <metric.icon size={21} aria-hidden="true" />
                  </span>
                  <ArrowUpRight className={styles.metricArrow} size={17} aria-hidden="true" />
                </div>
                <span className={styles.metricLabel}>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.help}</small>
              </Link>
            ))}
          </div>

          <div className={styles.columns}>
            <section className="panel stack">
              <div className={styles.sectionTitle}>
                <div>
                  <p className="eyebrow">PLANEJAMENTO</p>
                  <h2>Próximos serviços</h2>
                </div>
                <Link to="/app/agenda">Ver agenda →</Link>
              </div>
              {dashboard.data.nextAppointments.length ? (
                <div className={styles.appointments}>
                  {dashboard.data.nextAppointments.map(item => (
                    <Link className={styles.appointment} key={item.id} to={`/app/agenda/${item.id}`}>
                      <div className={styles.calendar}>
                        <CalendarDays size={20} />
                        <span>{dateTime(item.startsAt)}</span>
                      </div>
                      <div>
                        <strong>{item.serviceLabel}</strong>
                        <p>{item.location} · {item.teamName}</p>
                        <small>{item.code} · {item.responsibleName}</small>
                      </div>
                      <Badge tone={item.status === 'CONFIRMED' ? 'success' : 'neutral'}>
                        {appointmentLabels[item.status]}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Sem serviços na agenda"
                  description="Os próximos serviços aparecerão aqui conforme os filtros e o seu acesso."
                />
              )}
            </section>

            <section className="panel stack">
              <div className={styles.sectionTitle}>
                <div>
                  <p className="eyebrow">ACOMPANHAMENTO</p>
                  <h2>Revisão e correções</h2>
                </div>
                <Link to="/app/pts">Ver PTs →</Link>
              </div>
              {dashboard.data.pendingPermits.length ? (
                dashboard.data.pendingPermits.map(item => (
                  <Link key={item.id} to={`/app/pts/${item.id}`} className={styles.review}>
                    <Badge tone={item.reviewStatus === 'RETURNED' ? 'warning' : 'info'}>
                      {item.reviewStatus === 'RETURNED' ? 'Devolvida para correção' : 'Aguardando revisão'}
                    </Badge>
                    <strong>{item.code}</strong>
                    <span>{item.appointment.serviceLabel} · {item.appointment.location}</span>
                    <small>Operação concluída · versão {item.version}</small>
                  </Link>
                ))
              ) : (
                <EmptyState
                  title="Nenhuma revisão pendente"
                  description="A fila acompanha apenas as PTs do seu escopo para este filtro."
                />
              )}
              <Link className={styles.documentLink} to="/app/painel-documental">
                <FileSearch size={17} /> Consultar painel documental <ArrowUpRight size={15} />
              </Link>
            </section>
          </div>
          <p className="muted small">
            Atualizado em {dateTime(dashboard.data.generatedAt)} · Horários de Brasília (America/Sao_Paulo).
          </p>
        </>
      )}

      <Feedback>
        O atendimento aberto inicia a conferência. A execução depende da liberação por responsável designado e dos requisitos atendidos.
      </Feedback>
    </div>
  );
}
