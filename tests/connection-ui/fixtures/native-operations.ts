import type { NativeAppointment, NativeDesignation, NativeTeam } from '../../../src/features/native-operations/contracts';

// Fictitious native HTTP data. Worker IDs deliberately differ from User IDs.
export const operationIds = { company:'61000000-0000-4000-8000-000000000001',otherCompany:'61000000-0000-4000-8000-000000000002',
  unit:'62000000-0000-4000-8000-000000000001',otherUnit:'62000000-0000-4000-8000-000000000002',team:'63000000-0000-4000-8000-000000000001',organization:'63000000-0000-4000-8000-000000000002',
  worker:'64000000-0000-4000-8000-000000000001',user:'65000000-0000-4000-8000-000000000001',responsible:'65000000-0000-4000-8000-000000000002',
  service:'66000000-0000-4000-8000-000000000001',appointment:'67000000-0000-4000-8000-000000000001',designation:'68000000-0000-4000-8000-000000000001' };
const ids=operationIds;
export function appointmentFixture(): NativeAppointment {
  const item={id:ids.appointment,companyId:ids.company,locationId:ids.unit,teamId:ids.team,title:'Inspeção programada',status:'REQUESTED' as const,version:1,
    startsAt:'2099-11-20T12:00:00Z',endsAt:'2099-11-20T13:00:00Z',responsibleId:null,serviceCodes:['ALTURA'],participantIds:[ids.worker],requestedBy:ids.user,requestedViaInviteId:null};
  return {...item,history:[{action:'REQUESTED',version:1,actorId:ids.user,occurredAt:'2026-10-31T12:00:00Z',reason:null,before:null,after:appointmentState(item)}]};
}
export function appointmentState(item:Pick<NativeAppointment,'status'|'startsAt'|'endsAt'|'responsibleId'|'teamId'|'serviceCodes'|'participantIds'>){return{status:item.status,startsAt:item.startsAt,endsAt:item.endsAt,responsibleId:item.responsibleId,teamId:item.teamId,serviceCodes:[...item.serviceCodes],participantIds:[...item.participantIds]};}
export function teamFixture(): NativeTeam {return{id:ids.team,organizationId:ids.organization,companyId:ids.company,localId:ids.unit,name:'Equipe de manutenção',description:'Manutenção da unidade',chiefId:ids.worker,participantIds:[ids.worker],active:true};}
export function designationFixture():NativeDesignation{return{id:ids.designation,personId:ids.worker,serviceIds:[ids.service],locationIds:[ids.unit],type:'atender',startsAt:'2026-01-01T00:00:00Z',endsAt:'2099-12-31T00:00:00Z',origin:'Escala operacional',active:true,version:1,assignedBy:ids.user,revokedBy:null,revokedAt:null};}
export const nativePersonFixture={id:ids.worker,companyId:ids.company,unitId:ids.unit,fullName:'Alice Trabalhadora',registration:'MAT-01',status:'ACTIVE',admissionDate:'2024-01-01'};
export const nativeOrganizationFixture={companies:[{id:ids.company,name:'Empresa da operação',status:'ACTIVE'}],units:[{id:ids.unit,companyId:ids.company,name:'Unidade principal',status:'ACTIVE'}]};
export const nativeServicesFixture=[{id:ids.service,code:'ALTURA',name:'Trabalho em altura'}];
export const nativeResponsibleFixture={id:ids.responsible,name:'Roberto Responsável',email:'responsavel@example.invalid',roles:['PERFIL_PERSONALIZADO'],scopeIds:[ids.company],active:true};
