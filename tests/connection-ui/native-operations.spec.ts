// Explicit user-administration grants keep the setup page stable; module grants remain independent.
import { expect,test,type Page } from '@playwright/test';
import { appointmentFixture,appointmentState,designationFixture,teamFixture,operationIds as ids,nativePersonFixture,nativeOrganizationFixture,nativeServicesFixture,nativeResponsibleFixture } from './fixtures/native-operations';

// Controlled native HTTP contracts, not live .NET/PostgreSQL homologation.
async function setup(page:Page){
  const state={appointments:[appointmentFixture()],designations:[designationFixture()],conflict:false,denied:false,wrongTeam:false,commands:[] as {method:string;path:string;body:Record<string,unknown>}[],requests:[] as string[],unexpected:[] as string[],errors:[] as string[]};
  let signedIn=false;
  await page.clock.setFixedTime(new Date('2026-10-31T12:00:00Z'));await page.emulateMedia({reducedMotion:'reduce'});page.on('pageerror',error=>state.errors.push(error.message));
  await page.route('**/api/v1/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname.replace('/api/v1/browser/','/api/v1/'),method=route.request().method();state.requests.push(`${method} ${url.pathname}${url.search}`);
    const json=(value:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
    const session={accessToken:'native-operations-fixture',tokenType:'Bearer',accessExpiresAt:'2099-01-01T00:00:00Z'};
    if(path==='/api/v1/auth/csrf')return json({csrfToken:'native-operation-csrf'});
    if(path==='/api/v1/auth/login'){signedIn=true;return json(session);}
    if(path==='/api/v1/auth/refresh')return signedIn?json(session):json({code:'SESSION_EXPIRED',message:'Entre novamente.',requestId:'test'},401);
    if(path==='/api/v1/auth/me')return json({user:{id:ids.user,displayName:'Pessoa da operação',email:'operacao@example.invalid'},roles:['PERFIL_PERSONALIZADO'],permissions:['empresa:ler','unidade:ler','setor:ler','cargo:ler','trabalhador:ler','equipe:ler','pt:criar','pt:editar','usuario:ler', 'usuario:editar'],scope:{companyIds:[ids.company],unitIds:[ids.unit],sectorIds:[],teamIds:[],ownOnly:false},accessExpiresAt:session.accessExpiresAt});
    if(path==='/api/v1/organization')return json({...nativeOrganizationFixture,establishments:[],sectors:[],jobs:[],jobFunctions:[],workCenters:[]});
    if(path==='/api/v1/users')return json([nativeResponsibleFixture]);
    if(path==='/api/v1/work-permits/services')return json(nativeServicesFixture);
    if(path==='/api/v1/workers')return json({items:[nativePersonFixture],total:1,page:Number(url.searchParams.get('page')),pageSize:Number(url.searchParams.get('pageSize'))});
    if(path===`/api/v1/workers/${ids.worker}`)return json(nativePersonFixture);
    if(path==='/api/v1/teams'&&method==='GET')return json([{id:ids.team,organizationId:ids.organization,name:'Equipe de manutenção',chiefId:ids.worker,active:true}]);
    if(path===`/api/v1/teams/${ids.team}`&&method==='GET')return json({...teamFixture(),companyId:state.wrongTeam?ids.otherCompany:ids.company});
    if(path==='/api/v1/appointments'&&method==='GET'){
      if(state.denied)return json({code:'FORBIDDEN',message:'Detalhe privado',requestId:'test'},403);
      const filtered=state.appointments.filter(item=>(!url.searchParams.get('q')||item.title.toLowerCase().includes(url.searchParams.get('q')!.toLowerCase()))&&(!url.searchParams.get('status')||item.status===url.searchParams.get('status')));
      return json({items:filtered,total:filtered.length,page:Number(url.searchParams.get('page')),pageSize:Number(url.searchParams.get('pageSize'))});
    }
    if(path==='/api/v1/designations'&&method==='GET')return state.denied?json({code:'FORBIDDEN',message:'Detalhe privado',requestId:'test'},403):json(state.designations);
    if(path.startsWith('/api/v1/appointments/')&&method==='GET'){const item=state.appointments.find(item=>path===`/api/v1/appointments/${item.id}`);return item?json(item):json({code:'NOT_FOUND',requestId:'test'},404);}
    if(method==='POST'||method==='PUT'){
      const body=route.request().postDataJSON() as Record<string,unknown>;state.commands.push({method,path,body});
      if(state.conflict)return json({code:'DOMAIN_VIOLATION',message:'Detalhe privado',requestId:'test'},409);
      if(path==='/api/v1/appointments'){
        const item={...appointmentFixture(),id:'67000000-0000-4000-8000-000000000002',title:String(body.title),startsAt:String(body.startsAt),endsAt:String(body.endsAt),serviceCodes:['ALTURA'],participantIds:body.participantIds as string[]};
        item.history=[{...item.history[0],after:appointmentState(item)}];state.appointments.push(item);return json(item,201);
      }
      const item=state.appointments.find(item=>path.startsWith(`/api/v1/appointments/${item.id}/`));
      if(item){
        if(body.expectedVersion!==item.version)return json({code:'DOMAIN_VIOLATION',message:'Versão alterada',requestId:'test'},409);
        const before=appointmentState(item),action=path.split('/').at(-1)!;
        if(action==='confirm'){item.status='CONFIRMED';item.responsibleId=String(body.responsibleId);}
        if(action==='cancel')item.status='CANCELLED';
        if(action==='reschedule'){item.startsAt=String(body.startsAt);item.endsAt=String(body.endsAt);}
        if(action==='context'){item.teamId=String(body.teamId);item.participantIds=body.participantIds as string[];item.serviceCodes=['ALTURA'];}
        item.version++;item.history.push({action:({confirm:'CONFIRMED',cancel:'CANCELLED',reschedule:'RESCHEDULED',context:'CONTEXT_CHANGED'} as Record<string,string>)[action],version:item.version,actorId:ids.user,occurredAt:'2026-10-31T13:00:00Z',reason:body.reason?String(body.reason):null,before,after:appointmentState(item)});return json(item);
      }
      if(path==='/api/v1/designations'){
        const item={...designationFixture(),id:'68000000-0000-4000-8000-000000000002',personId:String(body.personId),serviceIds:body.serviceIds as string[],locationIds:body.locationIds as string[],type:body.type as 'liberar',origin:String(body.origin),startsAt:String(body.startsAt),endsAt:String(body.endsAt)};
        state.designations.push(item);return json(item,201);
      }
      const designation=state.designations.find(item=>path===`/api/v1/designations/${item.id}/revoke`);
      if(designation){designation.version++;designation.active=false;designation.revokedAt='2026-10-31T13:00:00Z';designation.revokedBy=ids.user;return json(designation);}
    }
    state.unexpected.push(`${method} ${path}`);return json({code:'NOT_FOUND',requestId:'test'},404);
  });
  await page.goto('/login');await expect(page.locator('[data-auth-scene]')).toHaveAttribute('data-arrival','ready');
  await page.getByLabel('E-mail',{exact:true}).fill('operacao@example.invalid');await page.getByLabel('Senha',{exact:true}).fill('Senha fictícia da operação');await page.getByRole('button',{name:'Entrar na plataforma',exact:true}).click();
  await expect(page).toHaveURL(/\/app\/configuracoes\/usuarios$/);await expect(page.getByText('Roberto Responsável',{exact:true})).toBeVisible();return state;
}
async function open(page:Page,module:string){await page.getByRole('button',{name:'Abrir navegação',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Navegação',exact:true});await dialog.getByRole('link',{name:module,exact:true}).click();await expect(dialog).toHaveCount(0);}
async function fillCreation(page:Page,kind:'appointment'|'designation'){
  if(kind==='appointment'){await page.getByRole('combobox',{name:'Equipe',exact:true}).selectOption(ids.team);await page.getByRole('checkbox',{name:/Alice Trabalhadora/}).check();await page.getByLabel('Título',{exact:true}).fill('Nova tarefa de manutenção');}
  else{await page.getByRole('combobox',{name:'Trabalhador',exact:true}).selectOption(ids.worker);await page.getByLabel('Origem',{exact:true}).fill('Escala de liberação');await page.getByRole('combobox',{name:'Tipo',exact:true}).selectOption('liberar');}
  await page.getByLabel('Início (Brasília)',{exact:true}).fill('2030-11-20T09:00');await page.getByLabel('Término (Brasília)',{exact:true}).fill('2030-11-20T10:00');await page.getByRole('checkbox',{name:'Trabalho em altura',exact:true}).check();
}

test('agenda nativa cancela com versão, preserva filtros e usa CANCELLED',async({page})=>{
  const state=await setup(page);await open(page,'Agenda');await page.getByLabel('Buscar por título',{exact:true}).fill('Inspeção');await page.getByRole('combobox',{name:'Situação',exact:true}).selectOption('REQUESTED');await page.getByRole('button',{name:'Buscar',exact:true}).click();
  await page.getByRole('link',{name:'Inspeção programada',exact:true}).click();await page.getByRole('button',{name:'Cancelar agendamento',exact:true}).click();await page.getByLabel('Motivo',{exact:true}).fill('Serviço cancelado pela equipe');await page.getByRole('button',{name:'Confirmar cancelamento',exact:true}).click();
  await expect(page.getByText('Alteração confirmada pela API.',{exact:true})).toBeVisible();expect(state.commands[0]).toEqual({method:'POST',path:`/api/v1/appointments/${ids.appointment}/cancel`,body:{expectedVersion:1,reason:'Serviço cancelado pela equipe'}});
  await page.getByRole('link',{name:'Voltar à agenda',exact:true}).click();await expect(page.getByRole('combobox',{name:'Situação',exact:true})).toHaveValue('REQUESTED');await expect(page.getByRole('heading',{name:'Nenhum agendamento encontrado',exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'Situação',exact:true}).selectOption('CANCELLED');await page.getByRole('button',{name:'Buscar',exact:true}).click();await expect(page.getByRole('link',{name:'Inspeção programada',exact:true})).toBeVisible();
  expect(state.requests.some(request=>request.includes('status=CANCELLED'))).toBe(true);expect(state.requests.filter(request=>request.includes('/appointments?')&&request.includes('unitId='))).toEqual([]);expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
});
test('conflito ao reagendar conserva o preenchimento e bloqueia reenvio com versão antiga',async({page})=>{
  const state=await setup(page);await open(page,'Agenda');await page.getByRole('link',{name:'Inspeção programada',exact:true}).click();await page.getByRole('button',{name:'Reagendar',exact:true}).click();await page.getByLabel('Motivo',{exact:true}).fill('Nova programação');state.conflict=true;
  await page.getByRole('button',{name:'Salvar alteração',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Seus dados foram mantidos');await expect(page.getByLabel('Motivo',{exact:true})).toHaveValue('Nova programação');await expect(page.getByRole('button',{name:'Salvar alteração',exact:true})).toBeDisabled();expect(state.commands[0].body.expectedVersion).toBe(1);expect(state.commands).toHaveLength(1);expect(state.errors).toEqual([]);
});
test('cria agendamento, altera contexto com PUT e confirma com ID de usuário',async({page})=>{
  const state=await setup(page);await open(page,'Agenda');await page.getByRole('link',{name:'Solicitar agendamento',exact:true}).click();await fillCreation(page,'appointment');await page.getByRole('button',{name:'Solicitar agendamento',exact:true}).click();
  await expect(page.getByText('Solicitação de agendamento registrada.',{exact:true})).toBeVisible();await page.getByRole('link',{name:'Nova tarefa de manutenção',exact:true}).click();
  expect(state.commands[0].body.participantIds).toEqual([ids.worker]);expect(state.commands[0].body.startsAt).toBe('2030-11-20T12:00:00.000Z');
  await page.getByRole('button',{name:'Alterar equipe e participantes',exact:true}).click();await page.getByRole('combobox',{name:'Equipe',exact:true}).selectOption(ids.team);await page.getByRole('checkbox',{name:/Alice Trabalhadora/}).check();await page.getByRole('checkbox',{name:'Trabalho em altura',exact:true}).check();await page.getByRole('button',{name:'Salvar contexto',exact:true}).click();await expect(page.getByText('Contexto confirmado pela API.',{exact:true})).toBeVisible();
  expect(state.commands[1].method).toBe('PUT');expect(state.commands[1].body).toEqual({expectedVersion:1,teamId:ids.team,serviceIds:[ids.service],participantIds:[ids.worker]});
  await page.getByRole('button',{name:'Confirmar agendamento',exact:true}).click();await page.getByRole('combobox',{name:'Responsável (usuário)',exact:true}).selectOption(ids.responsible);await page.getByRole('button',{name:'Salvar alteração',exact:true}).click();await expect(page.getByText('Alteração confirmada pela API.',{exact:true})).toBeVisible();expect(state.commands[2].body).toEqual({expectedVersion:2,responsibleId:ids.responsible});expect(state.commands[2].body.responsibleId).not.toBe(ids.worker);expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
});
test('cria e revoga designação preservando Worker.Id e expectedVersion',async({page})=>{
  const state=await setup(page);await open(page,'Designações');await page.getByRole('link',{name:'Nova designação',exact:true}).click();await fillCreation(page,'designation');await page.getByRole('button',{name:'Criar designação',exact:true}).click();await expect(page.getByText('Designação registrada.',{exact:true})).toBeVisible();
  expect(state.commands[0].body.personId).toBe(ids.worker);expect(state.commands[0].body.locationIds).toEqual([ids.unit]);await page.getByRole('button',{name:'Revogar Escala de liberação',exact:true}).click();await page.getByRole('button',{name:'Confirmar revogação',exact:true}).click();await expect(page.getByText('Revogação confirmada pela API.',{exact:true})).toBeVisible();expect(state.commands[1].body).toEqual({expectedVersion:1});expect(state.designations[1].active).toBe(false);expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
});
test('equipes são verificadas por empresa/local e não recebem comandos de escrita',async({page},testInfo)=>{
  await page.setViewportSize({width:320,height:900});const state=await setup(page);await open(page,'Equipes');await expect(page.getByText('Equipe de manutenção',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:testInfo.outputPath('equipes-nativas-mobile.png'),fullPage:true});
  await expect(page.getByRole('button',{name:/Criar equipe|Editar equipe|Desativar equipe/})).toHaveCount(0);state.wrongTeam=true;await page.getByRole('button',{name:'Atualizar equipes',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Não foi possível conferir');await expect(page.getByText('Equipe de manutenção',{exact:true})).toHaveCount(0);expect(state.commands).toEqual([]);expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
});
test('formulário nativo é utilizável em 320px e recusa término anterior ao início',async({page},testInfo)=>{
  await page.setViewportSize({width:320,height:900});const state=await setup(page);await open(page,'Agenda');await page.getByRole('link',{name:'Solicitar agendamento',exact:true}).click();await fillCreation(page,'appointment');await page.getByLabel('Término (Brasília)',{exact:true}).fill('2030-11-20T08:00');await page.getByRole('button',{name:'Solicitar agendamento',exact:true}).click();await expect(page.getByRole('alert')).toContainText('término posterior');expect(state.commands).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:testInfo.outputPath('agendamento-nativo-mobile.png'),fullPage:true});expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
});
