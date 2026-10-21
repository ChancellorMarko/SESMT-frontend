/** Contratos propostos para cadastro de equipes; nomes e empresa vêm do servidor. */
export interface TeamWriteDto {
  name: string;
  unitId: string;
  chiefId: string;
  members: { workerId: string; serviceFunction: string }[];
  status?: 'ACTIVE' | 'INACTIVE';
  inactiveReason?: string;
}

export interface TeamWorkerOptionDto { id: string; name: string; companyId: string; unitId: string }
export interface TeamOptionsDto { unitId: string; workers: TeamWorkerOptionDto[] }

export type TeamInviteStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface TeamInviteDto {
  id: string;
  token: string;
  teamId: string;
  teamName: string;
  unitId: string;
  unitName: string;
  companyId: string;
  companyName: string;
  status: TeamInviteStatus;
  unavailableReason?: 'TEAM_INACTIVE';
  expiresAt: string;
  createdAt: string;
  createdByName: string;
  membersCount: number;
  serviceFunctions: string[];
  shareUrl: string;
}

export interface TeamInviteWriteDto {
  teamId: string;
  validityHours?: number;
}

export interface PublicTeamInviteDto {
  token: string;
  teamId: string;
  teamName: string;
  unitName: string;
  companyName: string;
  chiefName: string;
  status: TeamInviteStatus;
  /** Temporary unavailability does not revoke a still-valid invitation. */
  unavailableReason?: 'TEAM_INACTIVE';
  expiresAt: string;
  members: { memberId?: string; name: string; serviceFunction: string; isChief: boolean }[];
  operationalInstructions: string;
  /** Proposed public request capability; the real API must explicitly enable it. */
  appointmentRequestsEnabled?: boolean;
  services?: { id: string; name: string; description?: string }[];
}

/** The server derives team, company, unit and worker identity from this invitation. */
export interface PublicInviteAppointmentWriteDto {
  serviceTypeIds: string[];
  location: string;
  startsAt: string;
  endsAt: string;
  participants: { memberId: string; serviceFunction: string }[];
  notes?: string;
  declarantName: string;
  acknowledged: true;
}

/** Deliberately excludes internal audit, documentary eligibility and PT data. */
export interface PublicInviteAppointmentDto {
  id: string;
  code: string;
  status: 'REQUESTED' | 'CONFIRMED' | 'ATTENDANCE_OPENED' | 'CANCELED';
  services: { id: string; name: string }[];
  location: string;
  requestedStartsAt: string;
  requestedEndsAt: string;
  confirmedStartsAt?: string;
  confirmedEndsAt?: string;
  participants: { name: string; serviceFunction: string }[];
  declarantName: string;
  requestedAt: string;
}
