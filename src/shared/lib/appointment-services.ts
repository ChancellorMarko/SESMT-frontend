import type { AppointmentWriteDto, ChecklistItemDto } from '../contracts/work-permits';

/** Never falls back when an explicit empty service set is returned. Invalid writes must be refused. */
export function appointmentServiceIds(appointment: Pick<AppointmentWriteDto, 'serviceTypeId' | 'serviceTypeIds'>): string[] {
  return appointment.serviceTypeIds === undefined ? [appointment.serviceTypeId] : [...appointment.serviceTypeIds];
}

export function checklistItemBlocked(item: ChecklistItemDto): boolean {
  const blockers = item.blockingAnswers ?? (item.required ? ['NO'] : []);
  return item.required && item.answer === null || item.answer !== null && blockers.includes(item.answer);
}
