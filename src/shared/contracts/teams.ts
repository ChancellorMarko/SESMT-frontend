/** Contratos propostos para cadastro de equipes; nomes e empresa vêm do servidor. */
export interface TeamWriteDto {
  name: string;
  unitId: string;
  chiefId: string;
  members: { workerId: string; serviceFunction: string }[];
}

export interface TeamWorkerOptionDto { id: string; name: string; companyId: string; unitId: string }
export interface TeamOptionsDto { unitId: string; workers: TeamWorkerOptionDto[] }
