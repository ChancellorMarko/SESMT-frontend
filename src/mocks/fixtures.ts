import type { OrganizationDto, UserDto, WorkerDto, DocumentTypeDto, DocumentDto, DocumentVersionDto, WorkerMovementDto, DocumentHistoryDto, NotificationDto, AuditLogDto, RoleDto } from '../shared/contracts';
import { dateOnly } from '../shared/lib/format';
export const id = (n:number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const COMPANY=id(1), UNIT_A=id(2), UNIT_B=id(3);
const now=()=>new Date().toISOString();
const date=(offset:number)=>{const d=new Date(`${dateOnly()}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
const read=['organization.read','workers.read','documents.read','documents.download','notifications.read'];
const workflow=['documents.write','documents.review','documents.approve','documents.publish','documents.archive','documents.signatures.verify'];
const permitRead=['appointments.read','permits.read','teams.read','eligibility.read','requirements.read','at.read','pet.read'];
const fieldOperator=[...read,...permitRead,'dashboard.read','permits.operate','eligibility.write','at.write','at.operate','pet.write'];
export const roles:RoleDto[]=[
 {code:'SESMT_MANAGER',label:'Gestor SESMT / Engenheiro',permissions:[...read,...workflow,...permitRead,'appointments.write','teams.write','requirements.write','at.write','pet.write','eligibility.write','eligibility.review','permits.review','workers.write','organization.write','dashboard.read','audit.read','documentTypes.write']},
 {code:'TECHNICIAN',label:'Técnico de segurança',permissions:fieldOperator},
 {code:'FIREFIGHTER',label:'Bombeiro',permissions:fieldOperator},
 {code:'HR',label:'Recursos Humanos',permissions:[...read,...permitRead,'eligibility.write','workers.write','dashboard.read']},
 {code:'AUDITOR',label:'Auditor',permissions:[...read,...permitRead,'audit.read','dashboard.read']},
 {code:'ADMIN',label:'Administrador',permissions:[...read,...workflow,...permitRead,'appointments.write','teams.write','requirements.write','at.write','pet.write','eligibility.write','eligibility.review','users.manage','workers.write','organization.write','dashboard.read','audit.read','documentTypes.write']},
 {code:'WORKER',label:'Trabalhador',permissions:read},
];
export const makeFixtures=()=>{
 const organization:OrganizationDto={
  companies:[{id:COMPANY,name:'Organização Exemplo',taxId:'00.000.000/0000-00',classification:'INTERNAL',code:'DEMO',status:'ACTIVE',revision:1}],
  establishments:[{id:id(4),name:'Estabelecimento Sul',companyId:COMPANY,status:'ACTIVE',revision:1}],
  units:[{id:UNIT_A,name:'Unidade Matriz',code:'MATRIZ',companyId:COMPANY,establishmentId:id(4),status:'ACTIVE',responsibleIds:[id(20)],revision:1},{id:UNIT_B,name:'Unidade Operacional',code:'OPER',companyId:COMPANY,establishmentId:id(4),status:'ACTIVE',responsibleIds:[id(20)],revision:1}],
  sectors:[{id:id(5),name:'Produção',unitId:UNIT_A,status:'ACTIVE',revision:1},{id:id(6),name:'Administrativo',unitId:UNIT_A,status:'ACTIVE',revision:1},{id:id(7),name:'Logística',unitId:UNIT_B,status:'ACTIVE',revision:1}],
  jobs:[{id:id(8),name:'Operador',companyId:COMPANY,status:'ACTIVE',revision:1},{id:id(9),name:'Analista',companyId:COMPANY,status:'ACTIVE',revision:1}],
  jobFunctions:[{id:id(10),name:'Operação de produção',companyId:COMPANY,jobId:id(8),status:'ACTIVE',revision:1},{id:id(11),name:'Assistência administrativa',companyId:COMPANY,jobId:id(9),status:'ACTIVE',revision:1}],
  workCenters:[{id:id(12),name:'Linha de produção A',unitId:UNIT_A,sectorId:id(5),status:'ACTIVE',revision:1},{id:id(13),name:'Centro de distribuição',unitId:UNIT_B,sectorId:id(7),status:'ACTIVE',revision:1}],
 };
 const users:UserDto[]=[['gestor','Marina Demo','SESMT_MANAGER'],['rh','Rafael Demo','HR'],['auditor','Ana Demo','AUDITOR'],['admin','Lucas Demo','ADMIN'],['trabalhador','Camila Demo','WORKER'],['tecnico','Diego Demo','TECHNICIAN'],['bombeiro','Felipe Demo','FIREFIGHTER']].map(([login,displayName,role],i)=>({id:id(20+i),displayName,email:`${login}@demo.sesmt.local`,roles:[role],status:'ACTIVE',mfaRequired:role==='ADMIN',revision:1,scope:{companyIds:[COMPANY],unitIds:role==='WORKER'?[UNIT_A]:[UNIT_A,UNIT_B],sectorIds:[id(5),id(6),id(7)],teamIds:role==='TECHNICIAN'||role==='FIREFIGHTER'?[id(200),id(201)]:[],ownOnly:role==='WORKER'}}));
 const workers:WorkerDto[]=['Camila Demo','Bruno Demo','Julia Demo','Pedro Demo','Sofia Demo','Gabriel Demo','Luiza Demo','André Demo'].map((fullName,i)=>{
  const intStatus = i === 2 ? 'PENDING' : i === 3 ? 'EXPIRED' : i === 4 ? 'NOT_APPLICABLE' : 'INTEGRATED';
  const intDate = i === 3 ? '2024-01-15' : '2025-03-12';
  const intValid = i === 3 ? '2025-01-15' : '2027-03-12';
  return {
    id:id(40+i),
    registration:`DEMO-${String(i+1).padStart(3,'0')}`,
    fullName,
    companyId:COMPANY,
    unitId:i<6?UNIT_A:UNIT_B,
    sectorId:i<4?id(5):i<6?id(6):id(7),
    jobId:i<4?id(8):id(9),
    jobFunctionId:i<4?id(10):id(11),
    employmentType:'CLT',
    admissionDate:'2025-03-10',
    managerId:id(20),
    status:i===4?'ON_LEAVE':'ACTIVE',
    revision:1,
    integrationStatus: intStatus,
    // Explicit synthetic policy exceptions keep the pre-existing completed demo scenarios.
    integrationEvidenceRequired: intStatus !== 'INTEGRATED' && intStatus !== 'NOT_APPLICABLE',
    integratedAt: intStatus === 'PENDING' || intStatus === 'NOT_APPLICABLE' ? undefined : intDate,
    integrationValidUntil: intStatus === 'PENDING' || intStatus === 'NOT_APPLICABLE' ? undefined : intValid,
    integrationResponsibleId: intStatus === 'PENDING' || intStatus === 'NOT_APPLICABLE' ? undefined : id(20),
    integrationResponsibleName: intStatus === 'PENDING' || intStatus === 'NOT_APPLICABLE' ? undefined : 'Marina Demo',
    integrationEvidenceFileName: intStatus === 'PENDING' || intStatus === 'NOT_APPLICABLE' ? undefined : `integracao-${String(i+1).padStart(3,'0')}.pdf`,
    integrationHistory: intStatus === 'PENDING' || intStatus === 'NOT_APPLICABLE' ? [] : [
      {
        id: crypto.randomUUID(),
        workerId: id(40+i),
        status: intStatus,
        integratedAt: intDate,
        validUntil: intValid,
        responsibleId: id(20),
        responsibleName: 'Marina Demo',
        evidenceFileName: `integracao-${String(i+1).padStart(3,'0')}.pdf`,
        notes: 'Integração de segurança e procedimentos da unidade.',
        registeredAt: `${intDate}T09:00:00Z`
      }
    ]
  };
 });
 const documentTypes:DocumentTypeDto[]=[
  {id:id(60),code:'PGR',name:'Programa de Gerenciamento de Riscos',category:'Programas de SST',requiredFields:['title','issueDate','validUntil'],allowedAccessClasses:['INTERNAL','RESTRICTED'],defaultAccessClass:'INTERNAL',allowedMimeTypes:['application/pdf','image/png','image/jpeg'],maxFileSizeBytes:10*1024*1024,renewalPolicy:{enabled:true,noticeDays:30,periodMonths:12},retentionPolicyReference:{code:'DEMO-PGR',version:'1',source:'Política ilustrativa; validar com responsável técnico.'},workflow:{reviewRequired:true,signatureRequired:true,allowSelfApproval:false,allowMultipleActiveVersions:false},revision:1},
  {id:id(61),code:'PROCED',name:'Procedimento operacional',category:'Procedimentos',requiredFields:['title','issueDate'],allowedAccessClasses:['INTERNAL','RESTRICTED'],defaultAccessClass:'INTERNAL',allowedMimeTypes:['application/pdf','image/png','image/jpeg'],maxFileSizeBytes:10*1024*1024,renewalPolicy:{enabled:true,noticeDays:30},retentionPolicyReference:{code:'DEMO-PROC',version:'1',source:'Política fictícia de demonstração.'},workflow:{reviewRequired:true,signatureRequired:false,allowSelfApproval:true,allowMultipleActiveVersions:false},revision:1},
  {id:id(62),code:'CERT',name:'Certificado e comprovante',category:'Evidências',requiredFields:['title','issueDate'],allowedAccessClasses:['INTERNAL','RESTRICTED'],defaultAccessClass:'RESTRICTED',allowedMimeTypes:['application/pdf','image/png','image/jpeg'],maxFileSizeBytes:5*1024*1024,renewalPolicy:{enabled:false,noticeDays:15},retentionPolicyReference:{code:'DEMO-EVID',version:'1',source:'Parâmetros ilustrativos; não são prazos legais.'},workflow:{reviewRequired:false,signatureRequired:false,allowSelfApproval:true,allowMultipleActiveVersions:false},revision:1},
 ];
 const seed=[['Inventário de riscos · Matriz','PGR-2026-001','ACTIVE',20,UNIT_A,id(60)],['Procedimento de trabalho seguro','PROC-2026-001','IN_REVIEW',120,UNIT_A,id(61)],['Orientação de segurança · Produção','PROC-2026-002','ACTIVE',65,UNIT_A,id(61)],['Evidência de treinamento introdutório','CERT-2026-001','EXPIRED',-12,UNIT_A,id(62)],['Plano de prevenção · Matriz','PROC-2026-003','DRAFT',90,UNIT_A,id(61)],['Procedimento de movimentação interna','PROC-2026-004','APPROVED',180,UNIT_A,id(61)],['Orientação para equipe de logística','PROC-2026-005','ACTIVE',18,UNIT_B,id(61)],['Comprovante de orientação individual','CERT-2026-002','ACTIVE',240,UNIT_A,id(62)]] as const;
 const documents:DocumentDto[]=seed.map(([title,code,status,offset,unitId,typeId],i)=>({id:id(80+i),code,title:`${title} (demo)`,typeId,companyId:COMPANY,unitId,sectorId:unitId===UNIT_A?id(5):id(7),workerIds:i===7?[id(40)]:[],ownerId:id(20),responsibleIds:[id(20)],accessClass:i===3?'RESTRICTED':'INTERNAL',issueDate:date(-180),validFrom:date(-150),validUntil:date(offset),keywords:['demonstração'],status,currentVersionId:id(100+i),activeVersionId:status==='ACTIVE'?id(100+i):undefined,activeVersionIds:status==='ACTIVE'?[id(100+i)]:[],availableActions:[],revision:1}));
 const versions:DocumentVersionDto[]=documents.map((d,i)=>({id:id(100+i),documentId:d.id,versionNumber:1,reason:'Versão sintética para desenvolvimento da interface.',status:d.status,metadataSnapshot:{...d},file:{id:id(120+i),name:`${d.code}-demo.pdf`,mimeType:'application/pdf',sizeBytes:900,sha256:'DEMONSTRACAO-SEM-HASH-DE-ARQUIVO-REAL',scanStatus:'CLEAN'},createdAt:now(),createdBy:id(24),review:d.status!=='DRAFT'?{decision:'ACCEPT',comment:'Revisão simulada.',actorId:id(20)}:undefined,approval:['APPROVED','ACTIVE','EXPIRED'].includes(d.status)?{actorId:id(20),comment:'Aprovação simulada.',approvedAt:now()}:undefined,signatureEvidences:[],availableActions:[],revision:1}));
 const movements:WorkerMovementDto[]=workers.map(w=>({id:crypto.randomUUID(),workerId:w.id,type:'ADMISSION',effectiveDate:w.admissionDate,reason:'Registro sintético de admissão.',previousAssignment:null,newAssignment:{unitId:w.unitId,sectorId:w.sectorId,jobId:w.jobId,jobFunctionId:w.jobFunctionId},createdAt:now(),createdBy:id(21)}));
 const history:DocumentHistoryDto[]=documents.map(d=>({id:crypto.randomUUID(),documentId:d.id,versionId:d.currentVersionId,action:'DOCUMENT_CREATED',actor:{id:id(20),displayName:'Marina Demo'},occurredAt:now(),reason:'Dados sintéticos de demonstração.'}));
 const notifications:NotificationDto[]=[documents[0],documents[1],documents[3],documents[6]].map((d,i)=>({id:id(150+i),type:d.status==='EXPIRED'?'DOCUMENT_EXPIRED':d.status==='IN_REVIEW'?'REVIEW_PENDING':'DOCUMENT_DUE',title:d.status==='IN_REVIEW'?'Documento aguardando revisão':d.status==='EXPIRED'?'Validade documental encerrada':'Documento próximo da validade',summary:d.title,resourceType:'DOCUMENT',resourceId:d.id,dueDate:d.validUntil,createdAt:now()}));
 const audit:AuditLogDto[]=documents.map(d=>({id:crypto.randomUUID(),actorId:id(20),action:'DOCUMENT_CREATED',resourceType:'DOCUMENT',resourceId:d.id,occurredAt:now(),requestId:crypto.randomUUID(),outcome:'DEMO'}));
 return {organization,users,workers,documentTypes,documents,versions,movements,history,notifications,audit};
};
