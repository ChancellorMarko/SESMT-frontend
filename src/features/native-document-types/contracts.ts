import {z} from 'zod';
import {InvalidReadResponse} from '../../shared/lib/verified-read';

const id=z.guid(), text=z.string().trim().min(1);
const version=z.number().int().positive();

const sourceText=(max:number)=>z.string().min(1).max(max).refine(v=>Boolean(v.trim()));

export const typeSchema=z.object({
  id,
  code:sourceText(50),
  name:sourceText(150),
  description:z.string().nullable(),
  category:sourceText(30),
  secrecyLevel:sourceText(20),
  requiresSignature:z.boolean(),
  requiresApproval:z.boolean(),
  periodicityInDays:z.number().int().nullable(),
  retentionPeriodInYears:z.number().int().nullable(),
  metadataSchema:z.string().max(1000000).refine(v=>{try{JSON.parse(v);return true;}catch{return false;}}),
  schemaVersion:z.number().int().positive(),
  active:z.literal(true),
  version,
}).strict();

const managed=z.object({item:typeSchema,version}).strict();

export type NativeDocumentType=z.infer<typeof typeSchema>;
export type ManagedType=z.infer<typeof managed>;

export const secrecyLabels:Record<string,string>={
  Interno:'Interno',Restrito:'Restrito',Medico:'Médico',
  INTERNO:'Interno',RESTRITO:'Restrito',MEDICO:'Médico',
};

export function checkedContext(raw:unknown){
  const p=z.object({canManage:z.boolean()}).strict().safeParse(raw);
  if(!p.success)throw new InvalidReadResponse();
  return p.data;
}

export function checkedType(raw:unknown,expectedId?:string){
  const p=managed.safeParse(raw);
  if(!p.success||expectedId&&p.data.item.id!==expectedId)throw new InvalidReadResponse();
  return p.data;
}

export function checkedNativeType(raw:unknown){
  const p=typeSchema.safeParse(raw);
  if(!p.success)throw new InvalidReadResponse();
  return p.data;
}

export function checkedPage(raw:unknown,page:number,q:string){
  const p=z.object({
    // List rows repeat the identifier beside the item (DocumentTypeListItemResponse).
    items:z.array(managed.extend({id}).strict().refine(r=>r.id===r.item.id)),
    total:z.number().int().nonnegative(),
    page:z.literal(page),
    pageSize:z.literal(20),
  }).strict().safeParse(raw);
  if(!p.success
    ||p.data.items.length!==Math.min(20,Math.max(p.data.total-(page-1)*20,0))
    ||new Set(p.data.items.map(r=>r.item.id)).size!==p.data.items.length
    ||p.data.items.some(r=>q&&![r.item.code,r.item.name,r.item.category].some(v=>v.toLocaleLowerCase().includes(q.toLocaleLowerCase()))))
    throw new InvalidReadResponse();
  return p.data;
}

export const historyLabels={
  DOCUMENT_TYPE_CREATED:'Cadastro',
  DOCUMENT_TYPE_RENAMED:'Identificação alterada',
  DOCUMENT_TYPE_UPDATED:'Identificação alterada',
  DOCUMENT_TYPE_DEACTIVATED:'Desativação',
} as const;

export function checkedHistory(raw:unknown){
  const p=z.array(z.object({
    id,
    action:z.enum(['DOCUMENT_TYPE_CREATED','DOCUMENT_TYPE_RENAMED','DOCUMENT_TYPE_UPDATED','DOCUMENT_TYPE_DEACTIVATED']),
    actorName:z.string().nullable(),
    occurredAt:z.string().datetime({offset:true}),
    version,
  }).strict()).safeParse(raw);
  if(!p.success||new Set(p.data.map(e=>e.id)).size!==p.data.length)throw new InvalidReadResponse();
  return p.data;
}

const optionalPositive=z.string().refine(s=>s===''||/^[1-9]\d{0,8}$/.test(s));

export const creationFields=z.object({
  code:text.max(50),
  name:text.max(150),
  description:z.string().trim().max(1000),
  category:text.max(30),
  secrecyLevel:z.enum(['Interno','Restrito','Medico']),
  requiresApproval:z.boolean(),
  requiresSignature:z.boolean(),
  days:optionalPositive,
  years:optionalPositive,
});
