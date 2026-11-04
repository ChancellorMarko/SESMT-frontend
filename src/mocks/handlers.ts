/** Respostas sintéticas interceptadas no navegador. Não implementa servidor/API real. */
import { http, HttpResponse, delay } from 'msw';
import type { DocumentDto, DocumentVersionDto, DocumentWriteDto, DocumentTypeDto, OrganizationItemDto, SignatureEvidenceDto, UserDto, WorkerDto, WorkerMovementDto, WorkerAssignment, DashboardDto, SessionDto, WorkerIntegrationWriteDto, WorkerIntegrationHistoryDto } from '../shared/contracts';
import { makeFixtures, roles, id, UNIT_A } from './fixtures';
import { makePermitDemo, PermitDemoError } from './work-permits';
import { makePetDemo, PetDemoError } from './confined-space-permits';
import type { AppointmentDto } from '../shared/contracts/work-permits';
import { dateOnly } from '../shared/lib/format';
import { isCivilDate } from '../features/documents/validation';
import { workerCreatePayload, workerPatchPayload, workerMovementPayload, workerIntegrationPayload, WorkerMutationError } from './worker-validation';
import { organizationResourceKeys, prepareOrganizationMutation, OrganizationMutationError } from './organization';
import { userAccessManageable, userAccessPayload, UserAccessError } from './user-access';
import { makeWorkerIntegrationDemo, IntegrationEvidenceError, type IntegrationEvidenceContext } from './worker-integration';
import { makeAccountInvitationDemo, AccountInvitationError } from './account-invitations';
let data=makeFixtures();
let accountInvitationDemo=createAccountInvitationDemo();
let integrationDemo=createIntegrationDemo();
let permitDemo=makePermitDemo(() => data.organization, () => data.workers,(w,start,end)=>integrationDemo.operationalState(w,start,end));
let petDemo=makePetDemo();
let currentUser:UserDto|undefined;
let currentToken='';
let challengeUser:UserDto|undefined;
let csrfToken='demo-csrf';
const blobs=new Map<string,Blob>();
const urls=new Set<string>();
const pendingScans=new Map<string,number>();
const idempotent=new Map<string,{body:unknown;status:number}>();
const time=()=>new Date().toISOString();
const civil=()=>dateOnly();
const plusDays=(days:number)=>{const d=new Date(`${civil()}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};

class MockError extends Error { constructor(public status:number,public code:string,message:string,public field?:string){super(message);} }
function fail(status:number,code:string,message:string,field?:string):never{throw new MockError(status,code,message,field);}
function check(condition:unknown,status:number,code:string,message:string,field?:string):asserts condition {if(!condition)fail(status,code,message,field);}
function permissions(){return roles.filter(r=>currentUser?.roles.includes(r.code)).flatMap(r=>r.permissions);}
function can(p:string){return permissions().includes(p);}
function requirePermission(p:string){check(can(p),403,'FORBIDDEN','Seu perfil não permite esta operação.');}
function requireIdentitySetup(user:UserDto){check(!accountInvitationDemo.requiresMfaSetup(user),403,'MFA_SETUP_REQUIRED','Sua senha foi definida. A configuração do autenticador ainda depende da integração de identidade; o acesso administrativo permanece bloqueado nesta demonstração.');check(!accountInvitationDemo.requiresWorkerLink(user),403,'WORKER_LINK_REQUIRED','Sua senha foi definida. O vínculo desta conta aos seus próprios dados ainda precisa ser configurado; o acesso permanece bloqueado nesta demonstração.');}
function requireSession(request:Request){
 check(currentUser,401,'UNAUTHENTICATED','Entre na plataforma para continuar.');
 check(request.headers.get('Authorization')===`Bearer ${currentToken}`,401,'TOKEN_EXPIRED','A sessão precisa ser renovada.');
 check(currentUser.status==='ACTIVE',401,'SESSION_REVOKED','Acesso desabilitado.');
 check(!currentUser.scope.expiresAt||Date.parse(currentUser.scope.expiresAt)>Date.now(),403,'FORBIDDEN','A concessão de acesso expirou.');
 requireIdentitySetup(currentUser);
}
function allowedUnit(unitId?:string){return !unitId || !!currentUser?.scope.unitIds.includes(unitId);}
function checkUnit(unitId:string){check(allowedUnit(unitId),404,'NOT_FOUND','Registro indisponível no seu escopo.');}
function workerVisible(w:WorkerDto){return !!currentUser?.scope.companyIds.includes(w.companyId)&&allowedUnit(w.unitId)&&(!currentUser?.scope.ownOnly||w.id===id(40));}
function docVisible(d:DocumentDto){return allowedUnit(d.unitId)&&d.accessClass!=='MEDICAL'&&(!currentUser?.scope.ownOnly||d.workerIds.includes(id(40)));}
function docById(docId:string){const d=data.documents.find(d=>d.id===docId&&docVisible(d));check(d,404,'NOT_FOUND','Documento não encontrado ou indisponível.');return d;}
function workerById(workerId:string){const w=data.workers.find(w=>w.id===workerId&&workerVisible(w));check(w,404,'NOT_FOUND','Trabalhador não encontrado ou indisponível.');return w;}
function versionById(d:DocumentDto,versionId:string){const v=data.versions.find(v=>v.id===versionId&&v.documentId===d.id);check(v,404,'NOT_FOUND','Versão indisponível.');return v;}
function etag(request:Request,record:{revision:number}){check(request.headers.has('If-Match'),428,'PRECONDITION_REQUIRED','Recarregue o registro antes de alterar.');check(request.headers.get('If-Match')===`"${record.revision}"`,412,'REVISION_CONFLICT','Este registro foi alterado. Recarregue e revise as diferenças antes de enviar.');}
function required(value:unknown,field:string){check(typeof value==='string'&&value.trim(),422,'VALIDATION_FAILED','Preencha este campo.',field);return value.trim();}
function merge<T extends object>(target:T,source:Record<string,unknown>){for(const[k,v]of Object.entries(source)){if(v===null)delete(target as Record<string,unknown>)[k];else if(v!==undefined)(target as Record<string,unknown>)[k]=v;}}
function paginate<T>(items:T[],url:URL){const page=Number(url.searchParams.get('page')||1);const pageSize=Number(url.searchParams.get('pageSize')||20);check(Number.isInteger(page)&&page>0&&Number.isInteger(pageSize)&&pageSize>0&&pageSize<=100,422,'VALIDATION_FAILED','Paginação inválida.');return{items:items.slice((page-1)*pageSize,page*pageSize),page,pageSize,total:items.length};}
function lookupRows<T extends {id:string}>(items:T[],url:URL,label:(item:T)=>string,search:(item:T)=>string=label){
 const rawIds=url.searchParams.getAll('ids');let selected:Set<string>|undefined;
 if(rawIds.length){
  check(rawIds.length===1,422,'VALIDATION_FAILED','Informe ids uma única vez, separados por vírgula.','ids');
  const ids=rawIds[0].split(',').map(value=>value.trim().toLocaleLowerCase('en-US'));
  check(ids.length<=100&&ids.every(value=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value)),422,'VALIDATION_FAILED','Informe de 1 a 100 UUIDs válidos separados por vírgula.','ids');
  selected=new Set(ids);
 }
 const q=(url.searchParams.get('q')||'').trim().toLocaleLowerCase('pt-BR');
 const rows=items.filter(item=>(!selected||selected.has(item.id.toLocaleLowerCase('en-US')))&&(!q||search(item).toLocaleLowerCase('pt-BR').includes(q)));
 return selected||q?rows.sort((a,b)=>label(a).localeCompare(label(b),'pt-BR')||a.id.localeCompare(b.id)):rows;
}
function queryScope(url:URL){const unit=url.searchParams.get('unitId');if(unit)checkUnit(unit);return unit;}
function scopedReadCriteria(url:URL, allowed:readonly string[], paged=true){
 for(const key of url.searchParams.keys())check(allowed.includes(key)&&url.searchParams.getAll(key).length===1,422,'VALIDATION_FAILED','O endereço contém critérios desconhecidos ou repetidos.',key);
 if(url.searchParams.has('unitId'))check(Boolean(url.searchParams.get('unitId')),422,'VALIDATION_FAILED','Informe uma unidade válida.','unitId');
 if(paged){
  const page=url.searchParams.get('page')??'1',size=url.searchParams.get('pageSize')??'20';
  check(/^[1-9]\d*$/.test(page)&&/^[1-9]\d*$/.test(size)&&Number.isSafeInteger(Number(page))&&Number(size)<=100&&Number(page)<=Math.floor(Number.MAX_SAFE_INTEGER/Number(size)),422,'VALIDATION_FAILED','Paginação inválida.');
 }
}
function manageableUser(user:UserDto){return !!currentUser&&userAccessManageable(user,currentUser.scope);}
function organizationAuditVisible(resourceId:string,unit:string|null){
 const user=currentUser;
 if(!user||user.scope.ownOnly)return false;
 const organization=data.organization;
 const selectedUnit=unit?organization.units.find(item=>item.id===unit):undefined;
 const companyVisible=(companyId?:string)=>!!companyId&&user.scope.companyIds.includes(companyId)&&(!unit||selectedUnit?.companyId===companyId);
 const unitVisible=(unitId?:string)=>{
  const record=organization.units.find(item=>item.id===unitId);
  return !!record&&allowedUnit(record.id)&&companyVisible(record.companyId)&&(!unit||record.id===unit);
 };
 const company=organization.companies.find(item=>item.id===resourceId);
 if(company)return companyVisible(company.id);
 const establishment=organization.establishments.find(item=>item.id===resourceId);
 if(establishment)return companyVisible(establishment.companyId)&&organization.units.some(item=>item.establishmentId===establishment.id&&unitVisible(item.id));
 const ownUnit=organization.units.find(item=>item.id===resourceId);
 if(ownUnit)return unitVisible(ownUnit.id);
 const local=[...organization.sectors,...organization.workCenters].find(item=>item.id===resourceId);
 if(local)return unitVisible(local.unitId);
 const global=[...organization.jobs,...organization.jobFunctions].find(item=>item.id===resourceId);
 if(global)return companyVisible(global.companyId);
 // An event without a resolvable organization owner cannot prove its scope.
 return false;
}
function dateRange(url:URL,from:string,to:string){const a=url.searchParams.get(from),b=url.searchParams.get(to);check((!a||isCivilDate(a))&&(!b||isCivilDate(b)),422,'VALIDATION_FAILED','Informe datas civis válidas para a consulta.');check(!a||!b||a<=b,422,'VALIDATION_FAILED','A data final deve ser posterior ou igual à inicial.');return{a,b};}
function filtered<T extends {unitId?:string}>(items:T[],unit:string|null){return items.filter(item=>allowedUnit(item.unitId)&&(!unit||item.unitId===unit));}
function makeSession():SessionDto{currentToken=`demo-${crypto.randomUUID()}`;return{accessToken:currentToken,tokenType:'Bearer',accessExpiresAt:new Date(Date.now()+3600000).toISOString()};}
function audit(action:string,resourceType:string,resourceId:string){data.audit.unshift({id:crypto.randomUUID(),actorId:currentUser!.id,action,resourceType,resourceId,occurredAt:time(),requestId:crypto.randomUUID(),outcome:'DEMO'});}
function history(d:DocumentDto,action:string,reason?:string,versionId?:string){data.history.unshift({id:crypto.randomUUID(),documentId:d.id,versionId,action,actor:{id:currentUser!.id,displayName:currentUser!.displayName},occurredAt:time(),reason});audit(action,'DOCUMENT',d.id);}
function documentActions(d:DocumentDto){const latest=data.versions.find(v=>v.id===d.currentVersionId);const actions:string[]=[];if(can('documents.write')&&d.status!=='ARCHIVED'){actions.push('CREATE_VERSION');if(!latest||latest.status==='DRAFT')actions.push('EDIT_METADATA');}if(can('documents.archive')&&d.status!=='ARCHIVED')actions.push('ARCHIVE');return{...d,availableActions:actions};}
function versionActions(v:DocumentVersionDto){const type=data.documentTypes.find(t=>t.id===v.metadataSnapshot.typeId)!;const a:string[]=[];if(v.file.scanStatus==='CLEAN'){if(can('documents.download'))a.push('DOWNLOAD','PREVIEW');if(v.status==='DRAFT'&&can('documents.write')&&type.workflow.reviewRequired)a.push('SUBMIT_REVIEW');if(v.status==='IN_REVIEW'&&can('documents.review')&&v.review?.decision!=='ACCEPT')a.push('REVIEW');if(can('documents.approve')&&(v.status==='DRAFT'&&!type.workflow.reviewRequired||v.status==='IN_REVIEW'&&v.review?.decision==='ACCEPT'))a.push('APPROVE');if(v.status==='APPROVED'){if(can('documents.write'))a.push('ADD_SIGNATURE_EVIDENCE');if(can('documents.signatures.verify')&&v.signatureEvidences.some(e=>e.file.scanStatus==='CLEAN'&&e.verificationStatus==='PENDING'))a.push('VERIFY_SIGNATURE_EVIDENCE');if(can('documents.publish')&&(!type.workflow.signatureRequired||v.signatureEvidences.some(e=>e.verificationStatus==='VERIFIED'&&e.file.scanStatus==='CLEAN')))a.push('PUBLISH');}}return{...v,availableActions:a};}
function processScans(){for(const [fileId,when]of pendingScans){if(Date.now()<when)continue;for(const v of data.versions){if(v.file.id===fileId)v.file.scanStatus='CLEAN';v.signatureEvidences.forEach(e=>{if(e.file.id===fileId)e.file.scanStatus='CLEAN';});}pendingScans.delete(fileId);}}
function validateManager(managerId:string|undefined|null,unitId:string,companyId:string){if(managerId)check(data.users.some(u=>u.id===managerId&&u.status==='ACTIVE'&&u.scope.unitIds.includes(unitId)&&u.scope.companyIds.includes(companyId)&&(!u.scope.expiresAt||Date.parse(u.scope.expiresAt)>Date.now())),422,'INVALID_ASSIGNMENT','Selecione um gestor ativo disponível na unidade.','managerId');}
function validateAssignment(w:{companyId?:string;unitId?:string;sectorId?:string;jobId?:string|null;jobFunctionId?:string|null;workCenterId?:string|null;managerId?:string|null}){
 required(w.companyId,'companyId');required(w.unitId,'unitId');required(w.sectorId,'sectorId');checkUnit(w.unitId!);
 check(currentUser?.scope.companyIds.includes(w.companyId!)&&data.organization.companies.some(c=>c.id===w.companyId&&c.status==='ACTIVE'),422,'INVALID_ASSIGNMENT','Empresa indisponível para o vínculo.','companyId');
 check(data.organization.units.some(u=>u.id===w.unitId&&u.companyId===w.companyId&&u.status==='ACTIVE'),422,'INVALID_ASSIGNMENT','Unidade incompatível com a empresa.','unitId');
 check(data.organization.sectors.some(s=>s.id===w.sectorId&&s.unitId===w.unitId&&s.status==='ACTIVE'),422,'INVALID_ASSIGNMENT','Setor incompatível com a unidade.','sectorId');
 if(w.jobId)check(data.organization.jobs.some(j=>j.id===w.jobId&&j.companyId===w.companyId&&j.status==='ACTIVE'),422,'INVALID_ASSIGNMENT','Cargo incompatível com a empresa.','jobId');
 if(w.jobFunctionId)check(data.organization.jobFunctions.some(f=>f.id===w.jobFunctionId&&f.companyId===w.companyId&&(!f.jobId||f.jobId===w.jobId)&&f.status==='ACTIVE'),422,'INVALID_ASSIGNMENT','Função incompatível com o vínculo.','jobFunctionId');
 if(w.workCenterId)check(data.organization.workCenters.some(c=>c.id===w.workCenterId&&c.unitId===w.unitId&&(!c.sectorId||c.sectorId===w.sectorId)&&c.status==='ACTIVE'),422,'INVALID_ASSIGNMENT','Centro de trabalho incompatível.','workCenterId');
 validateManager(w.managerId,w.unitId!,w.companyId!);
}
function validateDocument(body:DocumentWriteDto){for(const field of ['code','title','typeId','companyId','unitId','ownerId','accessClass','issueDate']as const)required(body[field],field);checkUnit(body.unitId);const type=data.documentTypes.find(t=>t.id===body.typeId);check(type,422,'VALIDATION_FAILED','Selecione um tipo documental válido.','typeId');check(type.allowedAccessClasses.includes(body.accessClass)&&body.accessClass!=='MEDICAL',403,'FORBIDDEN','Classificação fora do seu acesso.');check(data.organization.units.some(u=>u.id===body.unitId&&u.companyId===body.companyId&&u.status==='ACTIVE'),422,'INVALID_ASSIGNMENT','Unidade incompatível.','unitId');if(body.sectorId)check(data.organization.sectors.some(s=>s.id===body.sectorId&&s.unitId===body.unitId),422,'INVALID_ASSIGNMENT','Setor incompatível.','sectorId');check(!body.validFrom||!body.validUntil||body.validFrom<=body.validUntil,422,'VALIDATION_FAILED','Intervalo de vigência inválido.','validUntil');for(const field of type.requiredFields)check((body as unknown as Record<string,unknown>)[field]!==undefined&&(body as unknown as Record<string,unknown>)[field]!=='',422,'VALIDATION_FAILED','Campo obrigatório para este tipo.',field);for(const worker of body.workerIds||[])check(data.workers.some(w=>w.id===worker&&w.unitId===body.unitId&&workerVisible(w)),422,'INVALID_ASSIGNMENT','Trabalhador incompatível com o documento.','workerIds');return type;}
async function storeFile(file:FormDataEntryValue|null,type:DocumentTypeDto){check(file&&typeof file!=='string'&&Object.prototype.toString.call(file)==='[object File]',422,'VALIDATION_FAILED','Selecione um arquivo.','file');check(file.size>0&&file.size<=type.maxFileSizeBytes,413,'FILE_TOO_LARGE','Arquivo vazio ou acima do limite.','file');check(type.allowedMimeTypes.includes(file.type),415,'UNSUPPORTED_MEDIA_TYPE','Formato de arquivo não permitido.','file');const bytes=new Uint8Array(await file.arrayBuffer());const pdf=new TextDecoder().decode(bytes.slice(0,5))==='%PDF-';const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;const jpg=bytes[0]===255&&bytes[1]===216;check(file.type==='application/pdf'?pdf:file.type==='image/png'?png:file.type==='image/jpeg'?jpg:true,415,'UNSUPPORTED_MEDIA_TYPE','O conteúdo não corresponde ao formato informado.','file');const fileId=crypto.randomUUID();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');blobs.set(fileId,file);pendingScans.set(fileId,Date.now()+700);return{id:fileId,name:file.name,mimeType:file.type,sizeBytes:file.size,sha256:hash,scanStatus:'PENDING' as const};}
function demoPdf(){const stream='BT /F1 19 Tf 55 750 Td (DOCUMENTO DE DEMONSTRACAO) Tj 0 -35 Td /F1 11 Tf (Arquivo sintetico. Nenhuma validade documental real.) Tj ET';const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];let text='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(text.length);text+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=text.length;text+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return new Blob([text],{type:'application/pdf'});}
function download(file:{id:string;name:string;mimeType:string;scanStatus:string}){check(file.scanStatus==='CLEAN',409,'FILE_NOT_READY','O arquivo ainda não foi liberado.');const blob=blobs.get(file.id)||demoPdf();const url=URL.createObjectURL(blob);urls.add(url);return{url,expiresAt:new Date(Date.now()+60000).toISOString(),fileName:file.name,mimeType:file.mimeType};}
function createIntegrationDemo(){return makeWorkerIntegrationDemo({documents:()=>data.documents,versions:()=>data.versions,documentVisible:docVisible,storeFile,download,audit:(action,workerId)=>audit(action,'WORKER',workerId)});}
function createAccountInvitationDemo(){return makeAccountInvitationDemo({users:()=>data.users,onActivated:user=>data.audit.unshift({id:crypto.randomUUID(),actorId:user.id,action:'USER_ACTIVATED','resourceType':'USER',resourceId:user.id,occurredAt:time(),requestId:crypto.randomUUID(),outcome:'DEMO'})});}
function integrationContext(request:Request,w:WorkerDto):IntegrationEvidenceContext{return{worker:w,userId:currentUser!.id,userName:currentUser!.displayName,can,recheck:()=>{requireSession(request);check(workerById(w.id)===w,404,'NOT_FOUND','Registro indisponível.');}};}
export function resetDemo(){data=makeFixtures();accountInvitationDemo=createAccountInvitationDemo();integrationDemo=createIntegrationDemo();permitDemo.dispose();permitDemo=makePermitDemo(() => data.organization, () => data.workers,(w,start,end)=>integrationDemo.operationalState(w,start,end));petDemo=makePetDemo();currentUser=undefined;currentToken='';challengeUser=undefined;blobs.clear();pendingScans.clear();idempotent.clear();for(const url of urls)URL.revokeObjectURL(url);urls.clear();}

async function route(request:Request,url:URL,path:string){
 const method=request.method;const parts=path.split('/').filter(Boolean);const read=async<T,>()=>{try{return await request.json()as T;}catch{fail(422,'INVALID_JSON','Envie um corpo JSON válido.');}};
 if(path==='/auth/csrf')return{csrfToken};
 if(path==='/auth/login'&&method==='POST'){const body=await read<{email:string;password:string}>();check(request.headers.get('X-CSRF-Token')===csrfToken,403,'CSRF_INVALID','Recarregue a sessão antes de entrar.');const user=data.users.find(u=>u.email===body.email&&u.status==='ACTIVE');check(user&&accountInvitationDemo.matchesPassword(user,body.password),401,'INVALID_CREDENTIALS','Credenciais inválidas. Use um perfil de demonstração ou confira seu acesso.');requireIdentitySetup(user);if(user.mfaRequired){challengeUser=user;return{status:'MFA_REQUIRED',challengeId:'demo-challenge',expiresAt:new Date(Date.now()+300000).toISOString(),methods:['TOTP']};}currentUser=user;return makeSession();}
 if(path==='/auth/invitations/inspect'||path==='/auth/invitations/accept'){
  check(method==='POST',405,'METHOD_NOT_ALLOWED','Use o formulário de ativação para consultar este convite.');
  check(request.headers.get('X-CSRF-Token')===csrfToken,403,'CSRF_INVALID','Recarregue a proteção de acesso antes de continuar.');
  const body=await read<unknown>();check(!request.signal.aborted,409,'REQUEST_CANCELED','A solicitação foi cancelada. Confira o resultado antes de continuar.');
  return path.endsWith('/inspect')?accountInvitationDemo.inspect(body):accountInvitationDemo.accept(body,request.headers.get('Idempotency-Key')||undefined);
 }
 if(path==='/auth/mfa/verify'){const b=await read<{challengeId:string;code:string}>();check(challengeUser&&b.challengeId==='demo-challenge'&&b.code==='123456',401,'MFA_INVALID','Código inválido para a demonstração.');currentUser=challengeUser;challengeUser=undefined;return makeSession();}
 if(path==='/auth/password/forgot'&&method==='POST'){check(request.headers.get('X-CSRF-Token')===csrfToken,403,'CSRF_INVALID','Recarregue a proteção de acesso antes de continuar.');return{message:'Se houver uma conta associada a este e-mail, as instruções serão enviadas. Na demonstração, não há envio de mensagens.'};}
 if(path==='/auth/password/reset'&&method==='POST'){check(request.headers.get('X-CSRF-Token')===csrfToken,403,'CSRF_INVALID','Recarregue a proteção de acesso antes de continuar.');const b=await read<{token:string;newPassword:string}>();check(b.token==='demo-reset',410,'RESET_EXPIRED','Código inválido ou expirado.');check(b.newPassword.length>=8,422,'PASSWORD_POLICY','Na demonstração, utilize no mínimo oito caracteres.','newPassword');return undefined;}
 if(path==='/auth/refresh'){check(currentUser,401,'SESSION_EXPIRED','Sessão ausente.');check(currentUser.status==='ACTIVE',401,'SESSION_REVOKED','Acesso desabilitado.');check(!currentUser.scope.expiresAt||Date.parse(currentUser.scope.expiresAt)>Date.now(),403,'FORBIDDEN','A concessão de acesso expirou.');requireIdentitySetup(currentUser);check(request.headers.get('X-CSRF-Token')===csrfToken,403,'CSRF_INVALID','Proteção de sessão inválida.');return makeSession();}
 if(path==='/auth/logout'){currentUser=undefined;currentToken='';challengeUser=undefined;permitDemo.dispose();for(const u of urls)URL.revokeObjectURL(u);urls.clear();return undefined;}
 if(/^\/team-invites\/public\/[^/]+(?:\/appointments)?$/.test(path))return permitDemo.route(request,url,path);
 check(currentUser,401,'UNAUTHENTICATED','Entre na plataforma para continuar.');
 check(request.headers.get('Authorization')===`Bearer ${currentToken}`,401,'TOKEN_EXPIRED','A sessão precisa ser renovada.');
 check(currentUser.status==='ACTIVE',401,'SESSION_REVOKED','Acesso desabilitado.');
 check(!currentUser.scope.expiresAt||Date.parse(currentUser.scope.expiresAt)>Date.now(),403,'FORBIDDEN','A concessão de acesso expirou.');
 if(path==='/me')return{user:{id:currentUser.id,displayName:currentUser.displayName,email:currentUser.email},roles:currentUser.roles,permissions:permissions(),scope:currentUser.scope,workerId:currentUser.scope.ownOnly?id(40):undefined,accessExpiresAt:new Date(Date.now()+3600000).toISOString()};
 if(petDemo.handles(path)){
  if(method!=='GET')check(request.headers.get('X-CSRF-Token')===csrfToken,403,'CSRF_INVALID','Recarregue a sessão antes de continuar.');
  const context={user:currentUser,permissions:permissions(),workers:data.workers,checkUnit};
  const agenda=async(agendaPath:string)=>{
   const agendaUrl=new URL(url);agendaUrl.pathname=`/api/v1${agendaPath}`;
   return permitDemo.route(new Request(agendaUrl,{method:'GET',headers:request.headers,signal:request.signal}),agendaUrl,agendaPath,context);
  };
  const withCompany=(appointment:AppointmentDto)=>({...appointment,companyId:appointment.companyId||data.organization.units.find(unit=>unit.id===appointment.unitId)?.companyId});
  return petDemo.route(request,url,path,{...context,
   appointment:async id=>withCompany(await agenda(`/appointments/${id}`) as AppointmentDto),
   appointments:async()=>(await agenda('/appointments') as AppointmentDto[]).map(withCompany),
  });
 }
 if(permitDemo.handles(path)){if(method!=='GET')check(request.headers.get('X-CSRF-Token')===csrfToken,403,'CSRF_INVALID','Recarregue a sessão antes de continuar.');return permitDemo.route(request,url,path,{user:currentUser,permissions:permissions(),workers:data.workers,checkUnit});}
 if(path==='/organization'&&method==='GET'){requirePermission('organization.read');queryScope(url);const o=data.organization;return{...o,companies:o.companies.filter(c=>currentUser!.scope.companyIds.includes(c.id)),establishments:o.establishments.filter(e=>currentUser!.scope.companyIds.includes(e.companyId!)),units:o.units.filter(u=>allowedUnit(u.id)),sectors:o.sectors.filter(s=>allowedUnit(s.unitId)),workCenters:o.workCenters.filter(c=>allowedUnit(c.unitId)),jobs:o.jobs.filter(j=>currentUser!.scope.companyIds.includes(j.companyId!)),jobFunctions:o.jobFunctions.filter(f=>currentUser!.scope.companyIds.includes(f.companyId!))};}
 if(path==='/assignees'){
  const purpose=url.searchParams.get('purpose');
  check(purpose&&['DOCUMENT_OWNER','DOCUMENT_RESPONSIBLE','UNIT_RESPONSIBLE','WORKER_MANAGER'].includes(purpose),422,'INVALID_PURPOSE','Selecione uma finalidade válida para consultar responsáveis.','purpose');
  requirePermission(purpose==='WORKER_MANAGER'?'workers.write':purpose==='UNIT_RESPONSIBLE'?'organization.write':'documents.write');queryScope(url);
  const eligible=data.users.filter(u=>u.status==='ACTIVE'&&u.scope.companyIds.some(company=>currentUser!.scope.companyIds.includes(company))&&(!u.scope.expiresAt||Date.parse(u.scope.expiresAt)>Date.now())&&(!url.searchParams.get('unitId')||u.scope.unitIds.includes(url.searchParams.get('unitId')!))).map(u=>({id:u.id,displayName:u.displayName}));
  return paginate(lookupRows(eligible,url,u=>u.displayName),url);
 }
 const resource=parts[0] as keyof typeof organizationResourceKeys;
 if(Object.hasOwn(organizationResourceKeys,resource)){
  requirePermission('organization.write');check(method==='POST'&&parts.length===1||method==='PATCH'&&parts.length===2,405,'METHOD_NOT_ALLOWED','Operação indisponível para este cadastro.');
  const list=data.organization[organizationResourceKeys[resource]];
  const record=method==='PATCH'?list.find(r=>r.id===parts[1]):undefined;
  const checkRecordScope=()=>{
   if(method!=='PATCH')return;check(record&&list.includes(record),404,'NOT_FOUND','Registro indisponível.');
   if(resource==='companies')check(currentUser!.scope.companyIds.includes(record.id),404,'NOT_FOUND','Registro indisponível.');
   if(['establishments','units','jobs','job-functions'].includes(resource))check(record.companyId&&currentUser!.scope.companyIds.includes(record.companyId),404,'NOT_FOUND','Registro indisponível.');
   if(resource==='units')checkUnit(record.id);if(record.unitId)checkUnit(record.unitId);etag(request,record);
  };
  checkRecordScope();const body=await read<unknown>();requireSession(request);requirePermission('organization.write');checkRecordScope();
  const next=prepareOrganizationMutation(resource,body,data.organization,record,data.users);
  if(next.unitId)checkUnit(next.unitId);if(next.companyId)check(currentUser!.scope.companyIds.includes(next.companyId),403,'FORBIDDEN','Empresa fora do seu acesso.');
  if(record){
   const parentsChanged=['companyId','unitId','establishmentId','sectorId','jobId'].some(key=>next[key as keyof OrganizationItemDto]!==record[key as keyof OrganizationItemDto]);
   const inactivating=next.status==='INACTIVE'&&record.status!=='INACTIVE';
   if(parentsChanged||inactivating){
    const workersLinked=data.workers.some(w=>[w.companyId,w.unitId,w.sectorId,w.jobId,w.jobFunctionId,w.workCenterId].includes(record.id));
    const childrenLinked=Object.values(data.organization).flat().some(child=>child.id!==record.id&&(parentsChanged||child.status==='ACTIVE')&&[child.companyId,child.unitId,child.establishmentId,child.sectorId,child.jobId].includes(record.id));
    check(!workersLinked&&!childrenLinked,409,'RESOURCE_IN_USE','Há trabalhadores ou cadastros vinculados a este registro.');
   }
   for(const key of Object.keys(record))if(!(key in next))delete(record as unknown as Record<string,unknown>)[key];
   next.revision=record.revision+1;Object.assign(record,next);audit('ORGANIZATION_UPDATED','ORGANIZATION',record.id);return record;
  }
  next.id=crypto.randomUUID();next.status='ACTIVE';next.revision=1;list.push(next);audit('ORGANIZATION_CREATED','ORGANIZATION',next.id);return next;
 }
 if(parts[0]==='workers'){
  requirePermission(parts[2]==='integration'&&parts.length>=4?'workers.read':method==='GET'?'workers.read':'workers.write');const unit=queryScope(url);
  check(['GET','POST','PATCH'].includes(method),405,'METHOD_NOT_ALLOWED','Operação indisponível para trabalhadores.');
  if(parts.length===1&&method==='GET'){
   const status=url.searchParams.get('status');
   const companyId=url.searchParams.get('companyId');
   const teamId=url.searchParams.get('teamId');
   const integrationStatus=url.searchParams.get('integrationStatus');
   const activeTeams=permitDemo.teamsList();
   const teamMembersSet = teamId ? new Set(activeTeams.find(t=>t.id===teamId)?.members.map(m=>m.workerId)||[]) : null;
   const eligible=filtered(data.workers.filter(workerVisible),unit).filter(w=>{
     if(status && w.status !== status) return false;
     if(companyId && w.companyId !== companyId) return false;
     if(teamMembersSet && !teamMembersSet.has(w.id)) return false;
     if(integrationStatus && (w.integrationStatus || 'PENDING') !== integrationStatus) return false;
     return true;
   });
   return paginate(lookupRows(eligible,url,w=>w.fullName,w=>`${w.fullName} ${w.registration}`),url);
  }
  if(parts.length===1&&method==='POST'){
   const b=workerCreatePayload(await read<unknown>());requireSession(request);requirePermission('workers.write');validateAssignment(b);
   check(!data.workers.some(w=>w.companyId===b.companyId&&w.registration===b.registration),409,'REGISTRATION_IN_USE','Matrícula já cadastrada nesta empresa.','registration');
   const w={id:crypto.randomUUID(),status:'ACTIVE',revision:1,integrationStatus:'PENDING',integrationEvidenceRequired:true}as WorkerDto;merge(w,b);data.workers.unshift(w);
   data.movements.unshift({id:crypto.randomUUID(),workerId:w.id,type:'ADMISSION',effectiveDate:w.admissionDate,previousAssignment:null,newAssignment:{companyId:w.companyId,unitId:w.unitId,sectorId:w.sectorId,jobId:w.jobId,jobFunctionId:w.jobFunctionId},reason:'Cadastro inicial.',createdAt:time(),createdBy:currentUser!.id});audit('WORKER_CREATED','WORKER',w.id);return w;
  }
  const w=workerById(parts[1]);
  if(parts[2]==='integration'&&parts.length>=4)return integrationDemo.route(request,path,integrationContext(request,w));
  if(parts.length===2&&method==='GET')return {...w, teams: permitDemo.workerTeams(w.id)};
  if(parts.length===2&&method==='PATCH'){
   etag(request,w);const b=workerPatchPayload(await read<unknown>());requireSession(request);requirePermission('workers.write');check(workerById(w.id)===w,404,'NOT_FOUND','Registro indisponível.');etag(request,w);
   if(b.managerId!==undefined&&b.managerId!==w.managerId)validateManager(b.managerId,w.unitId,w.companyId);
   check(!b.registration||!data.workers.some(x=>x.id!==w.id&&x.companyId===w.companyId&&x.registration===b.registration),409,'REGISTRATION_IN_USE','Matrícula já cadastrada.','registration');merge(w,b);w.revision++;audit('WORKER_UPDATED','WORKER',w.id);return w;
  }
  if(parts[2]==='movements'&&method==='GET')return paginate(data.movements.filter(m=>m.workerId===w.id),url);
  if(parts[2]==='movements'&&parts.length===3&&method==='POST'){
   etag(request,w);const raw=await read<unknown>();requireSession(request);requirePermission('workers.write');check(workerById(w.id)===w,404,'NOT_FOUND','Registro indisponível.');etag(request,w);
   const b=workerMovementPayload(raw,w,civil());const previousAssignment={companyId:w.companyId,unitId:w.unitId,sectorId:w.sectorId,jobId:w.jobId,jobFunctionId:w.jobFunctionId,workCenterId:w.workCenterId,managerId:w.managerId};
   if(b.newAssignment){const destination={...previousAssignment,...b.newAssignment,companyId:b.newAssignment.companyId||w.companyId};validateAssignment(destination);check(!data.workers.some(x=>x.id!==w.id&&x.companyId===destination.companyId&&x.registration===w.registration),409,'REGISTRATION_IN_USE','Matrícula já cadastrada na empresa de destino.','registration');b.newAssignment=destination;merge(w,destination);}
   w.status=b.type==='LEAVE'?'ON_LEAVE':b.type==='TERMINATION'?'TERMINATED':'ACTIVE';w.revision++;
   const movement={...b,id:crypto.randomUUID(),workerId:w.id,previousAssignment,createdAt:time(),createdBy:currentUser!.id};data.movements.unshift(movement);audit('WORKER_MOVED','WORKER',w.id);return{movement,worker:w,createdPendingItems:0};
  }
   if(parts[2]==='integration'&&method==='GET')return paginate(w.integrationHistory||[],url);
   if(parts[2]==='integration'&&parts.length===3&&method==='POST'){
    etag(request,w);const b=workerIntegrationPayload(await read<unknown>());requireSession(request);requirePermission('workers.write');check(workerById(w.id)===w,404,'NOT_FOUND','Registro indisponível.');etag(request,w);
    check(w.status==='ACTIVE',409,'WORKER_INACTIVE','Registre a integração somente para um trabalhador ativo.');
    check(b.integratedAt>=w.admissionDate&&b.integratedAt<=civil(),422,'VALIDATION_FAILED','A realização deve estar entre a admissão e hoje.','integratedAt');
    check(!b.responsibleId||b.responsibleId===currentUser!.id,422,'INVALID_ASSIGNMENT','O responsável pelo registro é o usuário autenticado.','responsibleId');
    check(!b.responsibleName||b.responsibleName===currentUser!.displayName,422,'INVALID_ASSIGNMENT','O responsável pelo registro é o usuário autenticado.','responsibleName');
    const context=integrationContext(request,w),policy=integrationDemo.policy(w);
    check(!b.policyVersion||b.policyVersion===policy.version,412,'POLICY_CHANGED','A política mudou. Confira a política atual antes de registrar.','policyVersion');
    check(b.status!=='NOT_APPLICABLE'||policy.allowNotApplicable&&!!b.notes?.trim(),422,'INTEGRATION_REQUIRED','A política exige comprovação; não aplicável não está disponível neste contexto.','status');
    if(b.status==='INTEGRATED'){check(b.policyVersion===policy.version,422,'POLICY_REQUIRED','Confira a política atual da integração.','policyVersion');check(!b.validUntil||b.validUntil>=civil(),422,'VALIDATION_FAILED','Uma integração concluída deve estar válida na data atual.','validUntil');check(!policy.evidenceRequired||b.evidenceId,422,'INTEGRATION_EVIDENCE_REQUIRED','Vincule um comprovante conferido para concluir a integração.','evidenceId');}
    const evidence=b.evidenceId?integrationDemo.forRegistration(b.evidenceId,context,b.status==='INTEGRATED'):undefined;
    const respId=currentUser!.id,respName=currentUser!.displayName;
    w.integrationStatus=b.status;w.integratedAt=b.integratedAt;w.integrationValidUntil=b.validUntil;w.integrationResponsibleId=respId;w.integrationResponsibleName=respName;w.integrationEvidence=evidence;w.integrationEvidenceFileName=evidence?.file.name;w.integrationEvidenceRequired=policy.evidenceRequired;w.integrationPolicyVersion=policy.version;w.integrationHistory=w.integrationHistory||[];
    const entry:WorkerIntegrationHistoryDto={id:crypto.randomUUID(),workerId:w.id,status:b.status,integratedAt:b.integratedAt,validUntil:b.validUntil,responsibleId:respId,responsibleName:respName,evidenceFileName:evidence?.file.name,evidence:structuredClone(evidence),policyVersion:policy.version,evidenceRequired:policy.evidenceRequired,notes:b.notes,registeredAt:time()};w.integrationHistory.unshift(entry);w.revision++;audit('WORKER_INTEGRATION_UPDATED','WORKER',w.id);return {...w,teams:permitDemo.workerTeams(w.id)};
   }
 }
 if(parts[0]==='document-types'){requirePermission(method==='GET'?'documents.read':'documentTypes.write');if(method==='GET')return paginate(lookupRows(data.documentTypes,url,t=>t.name,t=>`${t.name} ${t.code}`),url);const b=await read<DocumentTypeDto>();required(b.name,'name');required(b.code,'code');check(b.allowedAccessClasses.length&&b.allowedAccessClasses.includes(b.defaultAccessClass)&&!b.allowedAccessClasses.includes('MEDICAL'),422,'INVALID_POLICY','Classes de acesso incompatíveis.','defaultAccessClass');check(b.maxFileSizeBytes>0&&b.allowedMimeTypes.length,422,'INVALID_POLICY','Defina limites e formatos de arquivo.');if(method==='POST'){check(!data.documentTypes.some(t=>t.code===b.code),409,'TYPE_CODE_IN_USE','Código de tipo já utilizado.','code');const t={...b,id:crypto.randomUUID(),revision:1};data.documentTypes.push(t);audit('TYPE_CREATED','DOCUMENT_TYPE',t.id);return t;}const t=data.documentTypes.find(t=>t.id===parts[1]);check(t,404,'NOT_FOUND','Tipo não encontrado.');etag(request,t);check(!data.documents.some(d=>d.typeId===t.id&&['APPROVED','ACTIVE'].includes(d.status)),409,'POLICY_IN_USE','Esta política está em uso por documentos aprovados. A API real deve versionar alterações antes de aplicá-las.');merge(t,b as unknown as Record<string,unknown>);t.revision++;return t;}
 if(parts[0]==='documents'){
  requirePermission(method==='GET'?'documents.read':parts.at(-1)==='download-url'?'documents.download':parts.at(-1)==='reviews'?'documents.review':parts.at(-1)==='approvals'?'documents.approve':parts.at(-1)==='publish'?'documents.publish':parts.at(-1)==='archive'?'documents.archive':parts.at(-1)==='verification'?'documents.signatures.verify':'documents.write');
  const unit=queryScope(url);
  if(parts.length===1&&method==='GET'){
   const q=(url.searchParams.get('q')||'').toLocaleLowerCase('pt-BR');
   const status=url.searchParams.get('status'),type=url.searchParams.get('typeId'),worker=url.searchParams.get('workerId'),responsible=url.searchParams.get('responsibleId');
   const validity=dateRange(url,'validUntilFrom','validUntilTo'),emission=dateRange(url,'issueDateFrom','issueDateTo');
   let docs=filtered(data.documents.filter(docVisible),unit).filter(d=>
    (!q||`${d.title} ${d.code} ${d.keywords.join(' ')}`.toLocaleLowerCase('pt-BR').includes(q))&&
    (!status||d.status===status)&&(!type||d.typeId===type)&&(!worker||d.workerIds.includes(worker))&&
    (!responsible||d.responsibleIds.includes(responsible))&&
    (!validity.a||!!d.validUntil&&d.validUntil>=validity.a)&&(!validity.b||!!d.validUntil&&d.validUntil<=validity.b)&&
    (!emission.a||d.issueDate>=emission.a)&&(!emission.b||d.issueDate<=emission.b));
   if(url.searchParams.get('sort')==='title:asc')docs=docs.sort((a,b)=>a.title.localeCompare(b.title));
   return paginate(docs.map(documentActions),url);
  }
  if(parts.length===1&&method==='POST'){const b=await read<DocumentWriteDto>();validateDocument(b);check(!data.documents.some(d=>d.code===b.code&&d.companyId===b.companyId),409,'DOCUMENT_CODE_IN_USE','Código documental já utilizado.','code');const d={...b,id:crypto.randomUUID(),workerIds:b.workerIds||[],responsibleIds:b.responsibleIds||[],keywords:b.keywords||[],status:'DRAFT',activeVersionIds:[],availableActions:[],revision:1}as DocumentDto;data.documents.unshift(d);history(d,'CREATED');return documentActions(d);}
  const d=docById(parts[1]);
  if(parts.length===2&&method==='GET'){audit('DOCUMENT_VIEWED','DOCUMENT',d.id);return documentActions(d);}
  if(parts.length===2&&method==='PATCH'){etag(request,d);check(documentActions(d).availableActions.includes('EDIT_METADATA'),409,'IMMUTABLE_VERSION','Versão aprovada exige uma nova versão.');const b=await read<DocumentWriteDto>();validateDocument({...d,...b});merge(d,b as unknown as Record<string,unknown>);d.revision++;const v=data.versions.find(v=>v.id===d.currentVersionId);if(v&&v.status==='DRAFT')v.metadataSnapshot={...v.metadataSnapshot,...b};history(d,'UPDATED');return documentActions(d);}
  if(parts[2]==='history')return paginate(data.history.filter(h=>h.documentId===d.id),url);
  if(parts[2]==='archive'){etag(request,d);const b=await read<{reason:string}>();required(b.reason,'reason');d.status='ARCHIVED';d.revision++;history(d,'ARCHIVED',b.reason);return documentActions(d);}
  if(parts[2]==='versions'){
   if(parts.length===3&&method==='GET')return paginate(data.versions.filter(v=>v.documentId===d.id).sort((a,b)=>b.versionNumber-a.versionNumber).map(versionActions),url);
   if(parts.length===3&&method==='POST'){etag(request,d);check(d.status!=='ARCHIVED',409,'INVALID_TRANSITION','Documento arquivado não recebe nova versão.');const form=await request.formData();const metadata=JSON.parse(String(form.get('metadata')||'{}'))as DocumentWriteDto;const type=validateDocument(metadata);const reason=required(form.get('reason'),'reason');const file=await storeFile(form.get('file'),type);const v:DocumentVersionDto={id:crypto.randomUUID(),documentId:d.id,versionNumber:1+Math.max(0,...data.versions.filter(v=>v.documentId===d.id).map(v=>v.versionNumber)),reason,status:'DRAFT',metadataSnapshot:metadata,file,createdAt:time(),createdBy:currentUser.id,signatureEvidences:[],availableActions:[],revision:1};data.versions.push(v);d.currentVersionId=v.id;d.revision++;if(!d.activeVersionIds.length)d.status='DRAFT';history(d,'VERSION_CREATED',reason,v.id);return versionActions(v);}
   const v=versionById(d,parts[3]);const type=data.documentTypes.find(t=>t.id===v.metadataSnapshot.typeId)!;
   if(parts.length===4&&method==='GET')return versionActions(v);
   const action=parts[4];
   if(action==='download-url'){const b=await read<{purpose:string}>();history(d,b.purpose==='PREVIEW'?'PREVIEWED':'DOWNLOADED',undefined,v.id);return download(v.file);}
   if(action==='signature-evidences'&&parts[6]==='download-url'){const e=v.signatureEvidences.find(e=>e.id===parts[5]);check(e,404,'NOT_FOUND','Evidência indisponível.');history(d,'PREVIEWED','Evidência de assinatura.',v.id);return download(e.file);}
   etag(request,v);check(v.file.scanStatus==='CLEAN',409,'FILE_NOT_READY','A verificação do arquivo está pendente.');
   if(action==='signature-evidences'&&parts.length===5){check(v.status==='APPROVED',409,'INVALID_TRANSITION','A versão precisa estar aprovada.');const f=await request.formData();const signerName=required(f.get('signerName'),'signerName'),signedAt=required(f.get('signedAt'),'signedAt');check(Number.isFinite(Date.parse(signedAt)),422,'VALIDATION_FAILED','Data da assinatura inválida.','signedAt');const file=await storeFile(f.get('file'),type);const e:SignatureEvidenceDto={id:crypto.randomUUID(),versionId:v.id,signerName,signedAt,method:'UPLOADED_EVIDENCE',evidenceFileId:file.id,file,verificationStatus:'PENDING'};v.signatureEvidences.push(e);v.revision++;history(d,'SIGNATURE_EVIDENCE_ADDED',undefined,v.id);return e;}
   const b=await read<{decision?:string;comment?:string}>();
   if(action==='signature-evidences'&&parts[6]==='verification'){const e=v.signatureEvidences.find(e=>e.id===parts[5]);check(e,404,'NOT_FOUND','Evidência indisponível.');check(v.status==='APPROVED'&&e.file.scanStatus==='CLEAN',409,'EVIDENCE_NOT_READY','A evidência não está pronta para conferência.');check(b.decision==='VERIFIED'||b.decision==='REJECTED',422,'VALIDATION_FAILED','Selecione uma decisão válida.');required(b.comment,'comment');e.verificationStatus=b.decision;v.revision++;history(d,'SIGNATURE_VERIFIED',b.comment,v.id);return e;}
   if(action==='submit-review'){check(v.status==='DRAFT',409,'INVALID_TRANSITION','A versão não está em rascunho.');v.status='IN_REVIEW';v.review=undefined;history(d,'REVIEW_SUBMITTED',b.comment,v.id);}
   else if(action==='reviews'){check(v.status==='IN_REVIEW',409,'INVALID_TRANSITION','A versão não está em revisão.');check(b.decision==='ACCEPT'||b.decision==='REQUEST_CHANGES',422,'VALIDATION_FAILED','Selecione uma decisão válida.');required(b.comment,'comment');v.review={decision:b.decision,comment:b.comment!,actorId:currentUser.id};if(b.decision==='REQUEST_CHANGES')v.status='DRAFT';history(d,'REVIEWED',b.comment,v.id);}
   else if(action==='approvals'){check((v.status==='DRAFT'&&!type.workflow.reviewRequired)||(v.status==='IN_REVIEW'&&v.review?.decision==='ACCEPT'),409,'REVIEW_REQUIRED','Conclua a revisão antes de aprovar.');check(type.workflow.allowSelfApproval||v.createdBy!==currentUser.id,409,'SELF_APPROVAL_DENIED','Esta política exige aprovação por outra pessoa.');v.status='APPROVED';v.approval={comment:b.comment,actorId:currentUser.id,approvedAt:time()};history(d,'APPROVED',b.comment,v.id);}
   else if(action==='publish'){check(v.status==='APPROVED',409,'INVALID_TRANSITION','A versão precisa estar aprovada.');check(!type.workflow.signatureRequired||v.signatureEvidences.some(e=>e.verificationStatus==='VERIFIED'&&e.file.scanStatus==='CLEAN'),409,'SIGNATURE_REQUIRED','Registre e confira a evidência de assinatura antes de publicar.');check(!v.metadataSnapshot.validUntil||v.metadataSnapshot.validUntil>=civil(),409,'BUSINESS_CONFLICT','Não é possível publicar uma versão com validade encerrada.');check(!v.metadataSnapshot.validFrom||v.metadataSnapshot.validFrom<=civil(),409,'BUSINESS_CONFLICT','A vigência desta versão ainda não iniciou.');const superseded=type.workflow.allowMultipleActiveVersions?[]:data.versions.filter(x=>x.documentId===d.id&&x.status==='ACTIVE'&&x.id!==v.id);superseded.forEach(x=>{x.status='SUPERSEDED';x.revision++;});v.status='ACTIVE';v.revision++;merge(d,v.metadataSnapshot as unknown as Record<string,unknown>);d.activeVersionIds=type.workflow.allowMultipleActiveVersions?[...new Set([...d.activeVersionIds,v.id])]:[v.id];d.activeVersionId=d.activeVersionIds.length===1?v.id:undefined;d.currentVersionId=v.id;d.status='ACTIVE';d.revision++;history(d,'PUBLISHED',b.comment,v.id);return{document:documentActions(d),version:versionActions(v),supersededVersionIds:superseded.map(x=>x.id),supersededVersionId:superseded.length===1?superseded[0].id:undefined};}
   else fail(404,'NOT_FOUND','Operação não prevista na demonstração.');
   v.revision++;if(!d.activeVersionIds.length){d.status=v.status;d.revision++;}return versionActions(v);
  }
 }
 if(parts[0]==='notifications'){
  requirePermission('notifications.read');
  if(path==='/notifications'&&method==='GET'){
   scopedReadCriteria(url,['unitId','page','pageSize','read']);const unit=queryScope(url),read=url.searchParams.get('read');
   check(read===null||read==='true'||read==='false',422,'VALIDATION_FAILED','Selecione um filtro de leitura válido.','read');
   return paginate(data.notifications.filter(n=>{const d=data.documents.find(d=>d.id===n.resourceId);return d&&docVisible(d)&&(!unit||d.unitId===unit);}).filter(n=>read===null||!!n.readAt===(read==='true')),url);
  }
  check(parts.length===3&&parts[2]==='read'&&method==='PATCH',405,'METHOD_NOT_ALLOWED','Use o registro explícito de leitura para alterar uma notificação.');
  scopedReadCriteria(url,['unitId'],false);const unit=queryScope(url),n=data.notifications.find(n=>n.id===parts[1]);
  check(n&&data.documents.some(d=>d.id===n.resourceId&&docVisible(d)&&(!unit||d.unitId===unit)),404,'NOT_FOUND','Aviso indisponível.');
  n.readAt??=time();return n;
 }
 if(path==='/dashboard'){requirePermission('dashboard.read');const unit=queryScope(url);const period=dateRange(url,'from','to');const docs=filtered(data.documents.filter(docVisible),unit).filter(d=>(!period.a||d.issueDate>=period.a)&&(!period.b||d.issueDate<=period.b));const due=docs.filter(d=>d.status==='ACTIVE'&&d.validUntil&&d.validUntil>=civil()&&d.validUntil<=plusDays(30));const stamp=time();const defs=[['DOCUMENTS_ACTIVE','Documentos vigentes',docs.filter(d=>d.status==='ACTIVE').length,'Quantidade de documentos com situação vigente'],['DOCUMENTS_EXPIRING','A vencer em 30 dias',due.length,'Janela ilustrativa de 30 dias definida no serviço de demonstração'],['DOCUMENTS_EXPIRED','Documentos vencidos',docs.filter(d=>d.status==='EXPIRED').length,'Quantidade de documentos com situação vencida'],['DOCUMENTS_IN_REVIEW','Aguardando revisão',docs.filter(d=>d.status==='IN_REVIEW').length,'Quantidade de documentos em revisão']]as const;return{generatedAt:stamp,filters:{unitId:unit||undefined,from:period.a||undefined,to:period.b||undefined},indicators:defs.map(([code,label,value,formula])=>({code,label,value,formula,period:period.a||period.b?`${period.a||'Início'} a ${period.b||'hoje'}`:'Todo o período',source:'Dados sintéticos da demonstração',updatedAt:stamp,targetFilter:{unitId:unit||undefined,...(period.a?{issueDateFrom:period.a}:{}),...(period.b?{issueDateTo:period.b}:{}),...(code==='DOCUMENTS_EXPIRING'?{status:'ACTIVE',validUntilFrom:civil(),validUntilTo:plusDays(30)}:{status:code==='DOCUMENTS_ACTIVE'?'ACTIVE':code==='DOCUMENTS_EXPIRED'?'EXPIRED':'IN_REVIEW'})} })),pendingItems:docs.filter(d=>d.status==='EXPIRED'||d.status==='IN_REVIEW'||due.includes(d)).map(d=>({id:d.id,title:d.title,resourceType:'DOCUMENT',resourceId:d.id,status:d.status,dueDate:d.validUntil}))}satisfies DashboardDto;}
 if(path==='/audit-logs'){requirePermission('audit.read');check(method==='GET',405,'METHOD_NOT_ALLOWED','A trilha de auditoria permite somente consulta.');scopedReadCriteria(url,['unitId','page','pageSize','action','from','to']);const unit=queryScope(url);const range=dateRange(url,'from','to'),action=url.searchParams.get('action');check(!action||/^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(action),422,'VALIDATION_FAILED','Informe um código de ação válido.','action');return paginate(data.audit.filter(a=>{const d=data.documents.find(d=>d.id===a.resourceId);const w=data.workers.find(w=>w.id===a.resourceId);const day=dateOnly(new Date(a.occurredAt));return(a.resourceType.toUpperCase()!=='ORGANIZATION'||organizationAuditVisible(a.resourceId,unit))&&(!d||docVisible(d)&&(!unit||d.unitId===unit))&&(!w||workerVisible(w)&&(!unit||w.unitId===unit))&&(!action||a.action===action)&&(!range.a||day>=range.a)&&(!range.b||day<=range.b);}),url);}
 if(path==='/roles'){requirePermission('users.manage');return roles;}
 if(parts[0]==='users'){
  requirePermission('users.manage');const unit=queryScope(url);
  if(method==='GET'&&parts.length===1){const q=(url.searchParams.get('q')||'').trim().toLocaleLowerCase('pt-BR');return paginate(data.users.filter(u=>manageableUser(u)&&(!unit||u.scope.unitIds.includes(unit))&&(!q||`${u.displayName} ${u.email}`.toLocaleLowerCase('pt-BR').includes(q))),url);}
  if(method==='GET'&&parts.length===3&&parts[2]==='invitation'){const user=data.users.find(user=>user.id===parts[1]&&manageableUser(user)&&(!unit||user.scope.unitIds.includes(unit)));check(user,404,'NOT_FOUND','Usuário indisponível.');return accountInvitationDemo.summary(user);}
  check(method==='POST'&&parts.length===1||method==='PATCH'&&parts.length===3&&parts[2]==='access',405,'METHOD_NOT_ALLOWED','Operação indisponível para a gestão de acessos.');
  const u=method==='PATCH'?data.users.find(u=>u.id===parts[1]&&manageableUser(u)):undefined;
  if(method==='PATCH'){check(u,404,'NOT_FOUND','Usuário indisponível.');etag(request,u);}
  const raw=await read<unknown>();requireSession(request);requirePermission('users.manage');
  if(u){check(data.users.includes(u)&&manageableUser(u),404,'NOT_FOUND','Usuário indisponível.');etag(request,u);}
  const b=userAccessPayload(raw,{actor:{scope:currentUser!.scope,permissions:permissions()},roles,organization:data.organization,teams:permitDemo.teamsList(),original:u});
  if(method==='POST'){check(!data.users.some(value=>value.email.toLocaleLowerCase('pt-BR')===b.email),409,'EMAIL_IN_USE','E-mail já utilizado.','email');const created={...b,id:crypto.randomUUID(),status:'INVITED',mfaRequired:b.roles.includes('ADMIN'),revision:1}as UserDto;data.users.push(created);accountInvitationDemo.issue(created);audit('USER_INVITED','USER',created.id);return created;}
  check(u,404,'NOT_FOUND','Usuário indisponível.');check(b.status!=='ACTIVE'||accountInvitationDemo.hasCredential(u),409,'ACCOUNT_ACTIVATION_REQUIRED','A pessoa precisa aceitar o convite e definir a própria senha antes de ativar este acesso.');check(u.id!==currentUser!.id||b.status==='ACTIVE'&&b.roles.includes('ADMIN'),409,'LAST_ADMIN','Nesta demonstração, o administrador atual deve manter seu acesso.');Object.assign(u,{roles:b.roles,scope:b.scope,status:b.status});u.mfaRequired=u.roles.includes('ADMIN');u.revision++;if(u.status==='DISABLED')accountInvitationDemo.revoke(u.id);audit('USER_ACCESS_UPDATED','USER',u.id);return u;
 }
 fail(404,'NOT_IMPLEMENTED_IN_DEMO','Este recurso não está disponível nesta versão de demonstração.');
}

export const handlers=[http.all('*/api/v1/*',async({request})=>{
 await delay(180);processScans();integrationDemo.processScans();const url=new URL(request.url);const path=url.pathname.replace(/^.*\/api\/v1/,'');
 try{
  if(!path.startsWith('/auth/')&&!path.startsWith('/team-invites/public/')){requireSession(request);if(!['GET','HEAD'].includes(request.method))check(request.headers.get('X-CSRF-Token')===csrfToken,403,'CSRF_INVALID','Recarregue a sessão antes de continuar.');}
  const key=request.headers.get('Idempotency-Key');
  const cacheKey=key&&!['GET','HEAD'].includes(request.method)&&!path.startsWith('/auth/')&&!path.startsWith('/team-invites/public/')?`${currentToken}:${request.method}:${path}${url.search}:${JSON.stringify([currentUser?.revision,currentUser?.scope,permissions()])}:${key}`:undefined;
  if(cacheKey&&idempotent.has(cacheKey)){
   if(!['GET','HEAD'].includes(request.method))check(request.headers.get('X-CSRF-Token')===csrfToken,403,'CSRF_INVALID','Recarregue a sessão antes de continuar.');
   const hit=idempotent.get(cacheKey)!;const revision=(hit.body as {revision?:number}|undefined)?.revision;
   if(/^\/workers\/[^/]+\/integration(?:\/|$)/.test(path)){
    const segments=path.split('/').filter(Boolean),w=workerById(segments[1]);requirePermission('workers.read');
    requirePermission(segments.at(-1)==='review'?'eligibility.review':segments.at(-1)==='download'?'documents.download':'workers.write');
    const receipt=hit.body as {id?:string;workerId?:string;companyId?:string;unitId?:string;integrationStatus?:string;integrationEvidence?:{id:string}};
    if(receipt.companyId||receipt.unitId)check(receipt.companyId===w.companyId&&receipt.unitId===w.unitId,404,'NOT_FOUND','O recibo não pertence ao vínculo atual.');
    const evidenceId=segments.length===6?segments[4]:receipt.workerId?receipt.id:receipt.integrationEvidence?.id;
    if(evidenceId)integrationDemo.forRegistration(evidenceId,integrationContext(request,w),receipt.integrationStatus==='INTEGRATED');
   }
   if(petDemo.handles(path)){
    // A stored mutation receipt must not reveal a PET after its current reach changes.
    const recordId=(hit.body as {id?:string}|undefined)?.id;
    check(recordId,404,'NOT_FOUND','PET indisponível no seu alcance.');
    const readPath=`/confined-space-permits/${encodeURIComponent(recordId)}`;
    const readUrl=new URL(url);readUrl.pathname=`/api/v1${readPath}`;
    await route(new Request(readUrl,{method:'GET',headers:request.headers,signal:request.signal}),readUrl,readPath);
    requireSession(request);
   }
   return hit.status===204?new HttpResponse(null,{status:204}):new HttpResponse(JSON.stringify(hit.body),{status:hit.status,headers:{'Content-Type':'application/json',...(revision?{ETag:`"${revision}"`}:{})}});
  }
  const result=await route(request,url,path);const status=result===undefined?204:request.method==='POST'&&['/documents','/workers','/users','/document-types','/appointments','/confined-space-permits','/team-invites'].includes(path)?201:200;if(cacheKey)idempotent.set(cacheKey,{body:structuredClone(result),status});const revision=(result as {revision?:number}|undefined)?.revision;return status===204?new HttpResponse(null,{status}):new HttpResponse(JSON.stringify(result),{status,headers:{'Content-Type':'application/json',...(revision?{ETag:`"${revision}"`}:{})}});
 }
 catch(error){const e=error instanceof MockError||error instanceof PermitDemoError||error instanceof PetDemoError||error instanceof WorkerMutationError||error instanceof OrganizationMutationError||error instanceof UserAccessError||error instanceof IntegrationEvidenceError||error instanceof AccountInvitationError?error:new MockError(500,'DEMO_ERROR','Não foi possível processar a demonstração. Confira os campos e tente novamente.');return HttpResponse.json({code:e.code,message:e.message,fieldErrors:e.field?[{field:e.field,code:e.code,message:e.message}]:undefined,requestId:crypto.randomUUID()},{status:e.status});}
})];
