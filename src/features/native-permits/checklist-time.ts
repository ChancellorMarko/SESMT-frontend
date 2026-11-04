import { appointmentInstant } from '../agenda/support';

/** An actual end can fall in the same minute as StartedAt; preserve its seconds. */
export function checklistEndInstant(value: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match || Number(match[1].slice(0, 4)) < 1) return undefined;
  const minute = appointmentInstant(match[1]), seconds = Number(match[2] ?? 0);
  return minute && seconds <= 59 ? new Date(Date.parse(minute) + seconds * 1000).toISOString() : undefined;
}
