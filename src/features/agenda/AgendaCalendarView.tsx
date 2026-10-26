import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { useAppQueryParams } from '../../shared/lib/app-query-params';
import { ChevronLeft, ChevronRight, Clock, MapPin, Users } from 'lucide-react';
import { motion, useAnimationControls } from 'framer-motion';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { useSession } from '../../shared/auth/SessionProvider';
import { Badge, Button } from '../../shared/ui';
import { appointmentDateOnly, appointmentLabels, appointmentTimeOnly } from './support';
import { calendarDate, calendarDays, calendarLabel, calendarMonthStart, calendarShiftDay, calendarShiftMonth, calendarToday, calendarWeekStart } from './calendar';
import styles from './Agenda.module.css';
import { permitAgendaNavigation } from './permit-agenda-navigation';

interface AgendaCalendarViewProps {
  appointments: AppointmentDto[];
  searchString?: string;
  initialDate?: string;
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function AgendaCalendarView({ appointments, searchString = '', initialDate }: AgendaCalendarViewProps) {
  const { can, sessionKey, unitId } = useSession();
  const [params, setParams] = useAppQueryParams();
  const fallback = calendarDate(initialDate) || calendarDate(appointmentDateOnly(appointments[0]?.startsAt || '')) || calendarToday();
  const viewDate = calendarDate(params.get('calendarDate')) || fallback;
  const mode = params.get('calendarMode') === 'week' ? 'week' : 'month';
  const selectedDay = params.has('day') ? calendarDate(params.get('day')) : viewDate;
  const days = calendarDays(viewDate, mode);
  const reduceMotion = useAppReducedMotion();
  const periodMotion = useAnimationControls();
  const dayMotion = useAnimationControls();
  const periodKey = `${mode}:${days[0]}`;
  const previousPeriod = useRef(periodKey);
  const previousDay = useRef(selectedDay);
  const dayButtons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | undefined>(undefined);
  const focusedDay = selectedDay && days.includes(selectedDay) ? selectedDay : days.includes(viewDate) ? viewDate : days[0];

  useEffect(() => {
    if (calendarDate(params.get('calendarDate'))) return;
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('calendarDate', viewDate);
      return next;
    }, { replace: true });
  }, [params, setParams, viewDate]);

  useLayoutEffect(() => {
    if (pendingFocus.current) {
      dayButtons.current.get(pendingFocus.current)?.focus();
      pendingFocus.current = undefined;
    }
  }, [viewDate, selectedDay, mode]);

  function settlePeriod() { periodMotion.stop(); periodMotion.set({ opacity: 1, y: 0 }); }
  function settleDay() { dayMotion.stop(); dayMotion.set({ opacity: 1, y: 0 }); }
  useEffect(() => {
    const changed = previousPeriod.current !== periodKey;
    previousPeriod.current = periodKey;
    // Day-key navigation keeps its focused grid steady; only period controls animate it.
    if (reduceMotion || !changed || Array.from(dayButtons.current.values()).some(button => button === document.activeElement)) {
      periodMotion.set({ opacity: 1, y: 0 }); return;
    }
    periodMotion.set({ opacity: .65, y: 6 });
    void periodMotion.start({ opacity: 1, y: 0, transition: { duration: .28, ease: [.22, 1, .36, 1] } });
    return () => periodMotion.stop();
  }, [periodMotion, reduceMotion, periodKey]);
  useEffect(() => {
    const changed = previousDay.current !== selectedDay;
    previousDay.current = selectedDay;
    if (reduceMotion || !selectedDay || !changed) { dayMotion.set({ opacity: 1, y: 0 }); return; }
    dayMotion.set({ opacity: .6, y: 6 });
    void dayMotion.start({ opacity: 1, y: 0, transition: { duration: .26, ease: [.22, 1, .36, 1] } });
    return () => dayMotion.stop();
  }, [dayMotion, reduceMotion, selectedDay]);

  function update(date: string, selected = date, nextMode = mode) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('view', 'calendar');
      next.set('calendarDate', date);
      next.set('day', selected);
      if (nextMode === 'week') next.set('calendarMode', 'week');
      else next.delete('calendarMode');
      return next;
    }, { flushSync: true });
  }

  function selectDay(date: string, focus = false) {
    if (focus) pendingFocus.current = date;
    const anchor = mode === 'month' && date.slice(0, 7) === viewDate.slice(0, 7) ? viewDate : date;
    update(anchor, date);
  }

  function movePeriod(direction: number) {
    const next = mode === 'week' ? calendarShiftDay(viewDate, direction * 7) : calendarShiftMonth(viewDate, direction);
    update(next);
  }

  function onDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let target: string | undefined;
    if (event.key in offsets) target = calendarShiftDay(date, offsets[event.key]);
    else if (event.key === 'Home') target = calendarWeekStart(date);
    else if (event.key === 'End') target = calendarShiftDay(calendarWeekStart(date), 6);
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const direction = event.key === 'PageUp' ? -1 : 1;
      target = mode === 'week' ? calendarShiftDay(date, direction * 7) : calendarShiftMonth(date, direction);
    }
    if (target) { event.preventDefault(); selectDay(target, true); }
  }

  const monthTitle = calendarLabel(calendarMonthStart(viewDate), { month: 'long', year: 'numeric' });
  const capitalizedMonth = monthTitle.charAt(0).toUpperCase() + monthTitle.slice(1);
  const title = mode === 'month' ? capitalizedMonth : `${calendarLabel(days[0], { day: '2-digit', month: '2-digit' })} a ${calendarLabel(days[6], { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
  const appointmentsByDay = new Map<string, AppointmentDto[]>();
  for (const appointment of appointments) {
    const day = appointmentDateOnly(appointment.startsAt);
    if (day) appointmentsByDay.set(day, [...(appointmentsByDay.get(day) || []), appointment]);
  }
  for (const items of appointmentsByDay.values()) items.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const selectedDayItems = selectedDay ? appointmentsByDay.get(selectedDay) || [] : [];
  const selectedLabel = selectedDay ? calendarLabel(selectedDay, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  // Preserve the initial period even when opening a detail is the first interaction.
  const returnParams = new URLSearchParams(searchString);
  returnParams.set('view', 'calendar');
  returnParams.set('calendarDate', viewDate);
  returnParams.set('day', selectedDay || 'none');
  if (mode === 'week') returnParams.set('calendarMode', 'week');
  else returnParams.delete('calendarMode');
  const fromSearch = `?${returnParams.toString()}`;

  return (
    <div className={styles.calendarContainer}>
      <header className={styles.calendarNav}>
        <div className={styles.monthControls}>
          <Button variant="ghost" onClick={() => movePeriod(-1)} aria-label={mode === 'week' ? 'Semana anterior' : 'Mês anterior'}><ChevronLeft size={18} aria-hidden="true" /></Button>
          <h2 className={styles.monthTitle} aria-live="polite">{title}</h2>
          <Button variant="ghost" onClick={() => movePeriod(1)} aria-label={mode === 'week' ? 'Próxima semana' : 'Próximo mês'}><ChevronRight size={18} aria-hidden="true" /></Button>
        </div>
        <div className={styles.calendarActions}>
          <div className={styles.viewToggle} role="group" aria-label="Período do calendário">
            <button type="button" className={`${styles.toggleBtn} ${mode === 'month' ? styles.toggleBtnActive : ''}`} aria-pressed={mode === 'month'} onClick={() => update(selectedDay || viewDate, selectedDay || viewDate, 'month')}>Mensal</button>
            <button type="button" className={`${styles.toggleBtn} ${mode === 'week' ? styles.toggleBtnActive : ''}`} aria-pressed={mode === 'week'} onClick={() => update(selectedDay || viewDate, selectedDay || viewDate, 'week')}>Semanal</button>
          </div>
          <Button variant="secondary" onClick={() => update(calendarToday())}>Hoje</Button>
        </div>
      </header>

      <p className={styles.calendarHint} id="agenda-calendar-keys">Selecione um dia para consultar os atendimentos. No teclado, use as setas para mudar o dia, Home/End para a semana e Page Up/Page Down para o período.</p>
      <motion.div data-agenda-calendar-period className={`${styles.calendarGrid} ${styles.motionArea}`} initial={false} animate={periodMotion} onFocusCapture={settlePeriod} onPointerDownCapture={settlePeriod} role="grid" aria-label={mode === 'month' ? `Calendário de ${capitalizedMonth}` : `Calendário semanal de ${title}`} aria-describedby="agenda-calendar-keys">
        <div className={styles.weekdaysHeader} role="row">
          {WEEKDAYS.map(day => <div className={styles.weekdayCell} key={day} role="columnheader">{day}</div>)}
        </div>
        <div className={styles.monthDaysGrid} role="rowgroup">
          {Array.from({ length: days.length / 7 }, (_item, row) => (
            <div className={styles.calendarWeek} role="row" key={days[row * 7]}>
              {days.slice(row * 7, row * 7 + 7).map(date => {
                const items = appointmentsByDay.get(date) || [];
                const fullDate = calendarLabel(date, { day: 'numeric', month: 'long', year: 'numeric' });
                const isSelected = selectedDay === date;
                return (
                  <div key={date} role="gridcell" aria-selected={isSelected} className={`${styles.dayCell} ${date.slice(0, 7) !== viewDate.slice(0, 7) ? styles.otherMonthCell : ''} ${isSelected ? styles.selectedDayCell : ''}`}>
                    <button type="button" ref={element => { if (element) dayButtons.current.set(date, element); else dayButtons.current.delete(date); }} className={styles.daySelect} tabIndex={focusedDay === date ? 0 : -1} aria-label={`${fullDate}: ${items.length} atendimento(s)`} aria-pressed={isSelected} onClick={() => selectDay(date)} onKeyDown={event => onDayKeyDown(event, date)}>
                      <span className={styles.dayNumber}>{Number(date.slice(8))}</span>
                      {items.length > 0 && <span className={styles.dayCountBadge} aria-hidden="true">{items.length}</span>}
                    </button>
                    <div className={styles.cellAppointments}>
                      {items.slice(0, 3).map(appointment => <Link key={appointment.id} to={`/app/agenda/${appointment.id}`} state={{ fromSearch }} className={`${styles.eventPill} ${appointment.status === 'CANCELED' ? styles.eventPillCanceled : appointment.status === 'REQUESTED' ? styles.eventPillRequested : styles.eventPillConfirmed}`} aria-label={`${appointment.code}: ${appointment.serviceLabel}, ${fullDate} às ${appointmentTimeOnly(appointment.startsAt)}, ${appointmentLabels[appointment.status]}`} title={`${appointment.code}: ${appointment.serviceLabel} (${appointment.teamName})`}><span className={styles.pillTime}>{appointmentTimeOnly(appointment.startsAt)}</span><span className={styles.pillTitle}>{appointment.serviceLabel}</span></Link>)}
                      {items.length > 3 && <button type="button" className={styles.morePillsBtn} aria-label={`Ver todos os ${items.length} atendimentos de ${fullDate}`} onClick={() => selectDay(date)}>+{items.length - 3} mais</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </motion.div>

      {selectedDay && (
        <motion.section data-agenda-day className={`panel stack ${styles.selectedDayPanel} ${styles.motionArea}`} initial={false} animate={dayMotion} onFocusCapture={settleDay} onPointerDownCapture={settleDay} aria-label={`Atendimentos em ${selectedLabel}`}>
          <div className={styles.selectedDayHeader}>
            <div><h3>Atendimentos em {selectedLabel}</h3><p className="muted" role="status">{selectedDayItems.length === 0 ? 'Nenhum atendimento agendado para esta data.' : `${selectedDayItems.length} atendimento(s) agendado(s) · Horário de Brasília`}</p></div>
            <Button variant="ghost" onClick={() => update(viewDate, 'none')}>Fechar detalhe do dia</Button>
          </div>
          {selectedDayItems.length > 0 && <div className={styles.cards}>
            {selectedDayItems.map(appointment => <article className={`panel ${styles.card}`} key={appointment.id}>
              <div className={styles.cardHeader}><div><p className={styles.cardCode}>{appointment.code}</p><h2><Link to={`/app/agenda/${appointment.id}`} state={{ fromSearch }}>{appointment.serviceLabel}</Link></h2><p className="muted">{appointment.teamName}</p></div><Badge tone={appointment.status === 'CANCELED' ? 'neutral' : appointment.status === 'REQUESTED' ? 'warning' : 'success'}>{appointmentLabels[appointment.status]}</Badge></div>
              <dl className={styles.metadata}>
                <div><dt><Clock size={13} aria-hidden="true" /> Horário</dt><dd>{appointmentTimeOnly(appointment.startsAt)} às {appointmentTimeOnly(appointment.endsAt)}{appointment.status === 'REQUESTED' && <small className="muted"> (Solicitado)</small>}{appointment.status === 'CONFIRMED' && <small className="muted"> (Confirmado)</small>}</dd></div>
                <div><dt><MapPin size={13} aria-hidden="true" /> Local</dt><dd>{appointment.location}</dd></div>
                <div><dt><Users size={13} aria-hidden="true" /> Participantes</dt><dd>{appointment.participants.length} pessoa(s)</dd></div>
                <div><dt>Responsável</dt><dd>{appointment.responsibleName}</dd></div>
              </dl>
              <div className="actions"><Link className="button button--secondary" to={`/app/agenda/${appointment.id}`} state={{ fromSearch }}>Consultar atendimento</Link>{appointment.permitId && can('permits.read') && <Link className="button button--ghost" to={`/app/pts/${encodeURIComponent(appointment.permitId)}`} state={permitAgendaNavigation({ permitAgendaReturnTo: { permitId: appointment.permitId, appointmentId: appointment.id, unitId, sessionKey, source: 'agenda', search: fromSearch } }, sessionKey, unitId, appointment.permitId)}>Ver PT →</Link>}</div>
            </article>)}
          </div>}
        </motion.section>
      )}
    </div>
  );
}
