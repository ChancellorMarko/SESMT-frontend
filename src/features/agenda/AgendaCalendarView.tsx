import { useState } from 'react';
import { Link } from 'react-router';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, Users } from 'lucide-react';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button } from '../../shared/ui';
import { appointmentDateOnly, appointmentLabels, appointmentTimeOnly } from './support';
import styles from './Agenda.module.css';

interface AgendaCalendarViewProps {
  appointments: AppointmentDto[];
  searchString?: string;
  initialDate?: string;
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function AgendaCalendarView({ appointments, searchString = '', initialDate }: AgendaCalendarViewProps) {
  const getInitialYearMonth = () => {
    if (initialDate && /^\d{4}-\d{2}/.test(initialDate)) {
      const [year, month] = initialDate.split('-').map(Number);
      return new Date(year, month - 1, 1);
    }
    if (appointments.length > 0) {
      const firstDate = appointmentDateOnly(appointments[0].startsAt);
      if (firstDate) {
        const [year, month] = firstDate.split('-').map(Number);
        return new Date(year, month - 1, 1);
      }
    }
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  };

  const [viewDate, setViewDate] = useState<Date>(getInitialYearMonth);
  const [selectedDay, setSelectedDay] = useState<string | null>(() => {
    if (initialDate && /^\d{4}-\d{2}-\d{2}/.test(initialDate)) return initialDate;
    if (appointments.length > 0) return appointmentDateOnly(appointments[0].startsAt);
    return null;
  });

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const prevMonth = () => {
    setViewDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setViewDate(new Date(year, month + 1, 1));
  };

  const goToToday = () => {
    const today = new Date();
    setViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    setSelectedDay(todayStr);
  };

  const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(viewDate);
  const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);

  // Generate calendar days
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // Map appointments by day (YYYY-MM-DD)
  const appointmentsByDay = new Map<string, AppointmentDto[]>();
  for (const appointment of appointments) {
    const day = appointmentDateOnly(appointment.startsAt);
    if (day) {
      const list = appointmentsByDay.get(day) || [];
      list.push(appointment);
      appointmentsByDay.set(day, list);
    }
  }

  // Build grid cells
  interface DayCell {
    dayNumber: number;
    dateStr: string;
    isCurrentMonth: boolean;
    items: AppointmentDto[];
  }

  const cells: DayCell[] = [];

  // Previous month trailing days
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const prevMonthDate = new Date(year, month - 1, d);
    const dateStr = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      dayNumber: d,
      dateStr,
      isCurrentMonth: false,
      items: appointmentsByDay.get(dateStr) || [],
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      dayNumber: d,
      dateStr,
      isCurrentMonth: true,
      items: appointmentsByDay.get(dateStr) || [],
    });
  }

  // Next month leading days to complete week rows (up to multiple of 7)
  const remainingCells = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= remainingCells; d++) {
    const nextMonthDate = new Date(year, month + 1, d);
    const dateStr = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      dayNumber: d,
      dateStr,
      isCurrentMonth: false,
      items: appointmentsByDay.get(dateStr) || [],
    });
  }

  const selectedDayItems = selectedDay ? (appointmentsByDay.get(selectedDay) || []) : [];
  const selectedDayFormatted = selectedDay
    ? (() => {
        const [y, m, d] = selectedDay.split('-');
        return `${d}/${m}/${y}`;
      })()
    : null;

  return (
    <div className={styles.calendarContainer}>
      <header className={styles.calendarNav}>
        <div className={styles.monthControls}>
          <Button variant="ghost" onClick={prevMonth} aria-label="Mês anterior">
            <ChevronLeft size={18} aria-hidden="true" />
          </Button>
          <h2 className={styles.monthTitle}>{capitalizedMonth}</h2>
          <Button variant="ghost" onClick={nextMonth} aria-label="Próximo mês">
            <ChevronRight size={18} aria-hidden="true" />
          </Button>
        </div>
        <div className={styles.calendarActions}>
          <Button variant="secondary" onClick={goToToday}>Hoje</Button>
        </div>
      </header>

      <div className={styles.calendarGrid} role="grid" aria-label={`Calendário de ${capitalizedMonth}`}>
        <div className={styles.weekdaysHeader} role="row">
          {WEEKDAYS.map(day => (
            <div className={styles.weekdayCell} key={day} role="columnheader">
              {day}
            </div>
          ))}
        </div>

        <div className={styles.monthDaysGrid}>
          {cells.map(cell => {
            const hasItems = cell.items.length > 0;
            const isSelected = selectedDay === cell.dateStr;
            return (
              <div
                key={cell.dateStr}
                role="gridcell"
                tabIndex={0}
                aria-selected={isSelected}
                className={`${styles.dayCell} ${!cell.isCurrentMonth ? styles.otherMonthCell : ''} ${isSelected ? styles.selectedDayCell : ''} ${hasItems ? styles.hasAppointments : ''}`}
                onClick={() => setSelectedDay(cell.dateStr)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedDay(cell.dateStr);
                  }
                }}
              >
                <div className={styles.dayCellHeader}>
                  <span className={styles.dayNumber}>{cell.dayNumber}</span>
                  {hasItems && (
                    <span className={styles.dayCountBadge} title={`${cell.items.length} atendimento(s)`}>
                      {cell.items.length}
                    </span>
                  )}
                </div>
                <div className={styles.cellAppointments}>
                  {cell.items.slice(0, 3).map(app => (
                    <Link
                      key={app.id}
                      to={`/app/agenda/${app.id}`}
                      state={{ fromSearch: searchString }}
                      className={`${styles.eventPill} ${app.status === 'CANCELED' ? styles.eventPillCanceled : app.status === 'REQUESTED' ? styles.eventPillRequested : styles.eventPillConfirmed}`}
                      title={`${app.code}: ${app.serviceLabel} (${app.teamName})`}
                      onClick={e => e.stopPropagation()}
                    >
                      <span className={styles.pillTime}>{appointmentTimeOnly(app.startsAt)}</span>
                      <span className={styles.pillTitle}>{app.serviceLabel}</span>
                    </Link>
                  ))}
                  {cell.items.length > 3 && (
                    <button
                      type="button"
                      className={styles.morePillsBtn}
                      onClick={e => {
                        e.stopPropagation();
                        setSelectedDay(cell.dateStr);
                      }}
                    >
                      +{cell.items.length - 3} mais
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedDay && (
        <section className={`panel stack ${styles.selectedDayPanel}`} aria-live="polite">
          <div className={styles.selectedDayHeader}>
            <div>
              <h3>Atendimentos em {selectedDayFormatted}</h3>
              <p className="muted">
                {selectedDayItems.length === 0
                  ? 'Nenhum atendimento agendado para esta data.'
                  : `${selectedDayItems.length} atendimento(s) agendado(s) · Horário de Brasília`}
              </p>
            </div>
            <Button variant="ghost" onClick={() => setSelectedDay(null)}>Fechar detalhe do dia</Button>
          </div>

          {selectedDayItems.length > 0 && (
            <div className={styles.cards}>
              {selectedDayItems.map(appointment => (
                <article className={`panel ${styles.card}`} key={appointment.id}>
                  <div className={styles.cardHeader}>
                    <div>
                      <p className={styles.cardCode}>{appointment.code}</p>
                      <h2>
                        <Link to={`/app/agenda/${appointment.id}`} state={{ fromSearch: searchString }}>
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
                      <dt><Clock size={13} aria-hidden="true" /> Horário</dt>
                      <dd>
                        {appointmentTimeOnly(appointment.startsAt)} às {appointmentTimeOnly(appointment.endsAt)}
                        {appointment.status === 'REQUESTED' && <small className="muted"> (Solicitado)</small>}
                        {appointment.status === 'CONFIRMED' && <small className="muted"> (Confirmado)</small>}
                      </dd>
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
                  </dl>

                  <div className="actions">
                    <Link
                      className="button button--secondary"
                      to={`/app/agenda/${appointment.id}`}
                      state={{ fromSearch: searchString }}
                    >
                      Consultar atendimento
                    </Link>
                    {appointment.permitId && (
                      <Link className="button button--ghost" to={`/app/pts/${appointment.permitId}`}>
                        Ver PT →
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
