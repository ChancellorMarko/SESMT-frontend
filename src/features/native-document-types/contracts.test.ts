import{describe,it,expect}from'vitest';
import{checkedContext,checkedType,checkedPage,checkedHistory,creationFields}from'./contracts';
const id='10000000-0000-4000-8000-000000000001';
const record={version:1,item:{id,code:'CAP',name:'Capacitação',description:null,category:'OPERACIONAL',secrecyLevel:'RESTRITO',requiresSignature:true,requiresApproval:true,periodicityInDays:null,retentionPeriodInYears:null,metadataSchema:'{}',schemaVersion:1,active:true,version:1}};
describe('catálogo documental nativo',()=>{
  it('confere contrato, versão, ID e dados recebidos sem aceitar a forma da demonstração',()=>{
    expect(checkedType(record,id)).toEqual(record);
    for(const raw of[{...record,version:'1'},{...record,item:{...record.item,id:'20000000-0000-4000-8000-000000000001'}},{...record,item:{...record.item,active:false}},{...record,item:{...record.item,workflow:{signatureRequired:false}}}])expect(()=>checkedType(raw,id)).toThrow();
  });
  it('recusa capacidade presumida e confirma contexto somente pelo booleano publicado',()=>{
    expect(checkedContext({canManage:false}).canManage).toBe(false);for(const v of[{}, {canManage:'true'}, {canManage:true,role:'ADMIN'}])expect(()=>checkedContext(v)).toThrow();
  });
  it('preserva literalmente a política legada ao preparar uma edição de identificação',()=>{
    const source={...record,item:{...record.item,category:' OPERACIONAL ',secrecyLevel:'Medico',code:' CAP '}};
    expect(checkedType(source).item).toEqual(source.item);
  });
  it('confere total, duplicidade e correspondência da busca',()=>{
    const row={id,...record},page={items:[row],total:1,page:1,pageSize:20};expect(checkedPage(page,1,'Capacitação').items).toHaveLength(1);
    for(const v of[{...page,total:2},{...page,items:[row,row],total:2},{...page,items:[record]},{...page,items:[{...row,id:'20000000-0000-4000-8000-000000000001'}]},{...page,page:2}])expect(()=>checkedPage(v,1,'')).toThrow();expect(()=>checkedPage(page,1,'Outro')).toThrow();
  });
  it('não transforma prazo vazio em periodicidade presumida e recusa zero ou fração',()=>{
    const fields={code:'CAP',name:'Capacitação',description:'',category:'OPERACIONAL',secrecyLevel:'Restrito',requiresSignature:true,requiresApproval:true,days:'',years:''};expect(creationFields.parse(fields).days).toBe('');
    for(const patch of[{days:'0'},{years:'-1'},{days:'1.5'},{name:''},{secrecyLevel:'PUBLICO'}])expect(creationFields.safeParse({...fields,...patch}).success).toBe(false);
  });
  it('recusa eventos repetidos e conteúdo inesperado no histórico',()=>{
    const event={id,action:'DOCUMENT_TYPE_CREATED',actorName:null,occurredAt:'2026-11-03T12:00:00Z',version:record.version};expect(checkedHistory([event])).toHaveLength(1);
    for(const v of[[event,event],[{...event,action:'FAKE_APPROVAL'}],[{...event,item:record.item}]])expect(()=>checkedHistory(v)).toThrow();
  });
});
