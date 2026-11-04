import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers, resetDemo } from './handlers';
import { id, UNIT_A, UNIT_B } from './fixtures';
import type { DocumentDto, PageDto, SessionDto } from '../shared/contracts';
import { dateOnly } from '../shared/lib/format';
import { addCivilDays } from '../features/documents/expiry';
const server=setupServer(...handlers);
let token='';
async function login(role='gestor') {
  const response=await fetch('http://localhost/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':'demo-csrf'},body:JSON.stringify({email:`${role}@demo.sesmt.local`,password:'Demo123!'})});
  expect(response.status).toBe(200);token=(await response.json() as SessionDto).accessToken;
}
function query(params:Record<string,string>) {return fetch(`http://localhost/api/v1/documents?${new URLSearchParams(params)}`,{headers:{Authorization:`Bearer ${token}`}});}
async function documents(params:Record<string,string>){const response=await query(params);expect(response.status).toBe(200);return await response.json() as PageDto<DocumentDto>;}
beforeAll(()=>server.listen({onUnhandledRequest:'error'}));
afterAll(()=>server.close());
afterEach(()=>{server.resetHandlers();resetDemo();});
beforeEach(async()=>{resetDemo();await login();});
describe('filtros documentais no serviço de demonstração',()=>{
  it('filtra pelo responsável solicitado em vez de ignorar o parâmetro',async()=>{
    const matching=await documents({unitId:UNIT_A,responsibleId:id(20),pageSize:'100'});
    expect(matching.items.length).toBeGreaterThan(0);
    expect(matching.items.every(item=>item.unitId===UNIT_A&&item.responsibleIds.includes(id(20)))).toBe(true);
    expect((await documents({unitId:UNIT_A,responsibleId:id(21)})).total).toBe(0);
  });
  it('combina situação e validade com isolamento de unidade e escopo pessoal',async()=>{
    const filters={status:'ACTIVE',validUntilFrom:dateOnly(),validUntilTo:addCivilDays(dateOnly(),30)};
    expect((await documents({...filters,unitId:UNIT_A})).items.map(item=>item.code)).toEqual(['PGR-2026-001']);
    expect((await documents({...filters,unitId:UNIT_B})).items.map(item=>item.code)).toEqual(['PROC-2026-005']);
    await login('trabalhador');
    expect((await documents({...filters,unitId:UNIT_A})).total).toBe(0);
    expect((await query({...filters,unitId:UNIT_B})).status).toBe(404);
  });
  it('rejeita datas impossíveis ou intervalos invertidos no serviço simulado',async()=>{
    const cases:Record<string,string>[]=[{validUntilTo:'2026-02-30'},{issueDateFrom:'invalida'},{validUntilFrom:'2026-12-31',validUntilTo:'2026-01-01'}];
    for(const filters of cases){
      expect((await query({...filters,unitId:UNIT_A})).status).toBe(422);
    }
  });
});
