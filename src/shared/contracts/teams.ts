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
  expiresAt: string;
  members: { name: string; serviceFunction: string; isChief: boolean }[];
  operationalInstructions: string;
}
