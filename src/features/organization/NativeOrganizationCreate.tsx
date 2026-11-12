import { useState, type ReactNode } from 'react';
import { z } from 'zod';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { Field } from '../../shared/ui';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checkedOrganization, companyFields, companyReceipt, unitFields, unitReceipt, departmentFields, departmentReceipt, positionFields, positionReceipt, type NativeOrganization, type organizationResources } from './native-organization';
import styles from './NativeOrganizationPage.module.css';
import { fieldsForEdit, saveOrganizationEdit, type OrganizationEditProfile } from './native-organization-edit';

type Resource = typeof organizationResources[number];
export function NativeOrganizationCreate({ resource, context, opening, history, onClose, onDone }: { resource: Resource; context: NativeOrganization; opening?: OrganizationEditProfile; history?: ReactNode; onClose: () => void; onDone: () => Promise<void> }) {
  const { can } = useSession();
  const companies = context.companies.filter(c => opening || (resource.key === 'units' ? c.canCreateUnit : c.canCreatePosition));
  const units = context.units.filter(u => opening || u.canCreateDepartment);
  const [fields, setFields] = useState<Record<string, string>>({ name: '', corporateName: '', fantasyName: '', cnpj: '', tipoEmpresa: 'INTERNA', email: '', phone: '',
    companyId: companies.length === 1 ? companies[0].id : '', unitId: units.length === 1 ? units[0].id : '', code: '', type: 'MATRIZ', cep: '', address: '', number: '', complement: '', neighborhood: '', city: '', state: '', description: '', cbo: '', ...(opening ? fieldsForEdit(opening) : {}) });
  const [dirty, setDirty] = useState(false);
  const [reason,setReason] = useState(''), [confirmed,confirm] = useState(false);
  function change(key: string, value: string) { setFields(current => ({ ...current, [key]: value })); setDirty(true); confirm(false); }
  async function perform(signal: AbortSignal) {
    if (opening) { await saveOrganizationEdit(opening,fields,reason,confirmed,signal); return; }
    if (!can(resource.permission)) throw new NativeContextConflict('Seu acesso mudou. Atualize a consulta.');
    const schema = resource.key === 'companies' ? companyFields : resource.key === 'units' ? unitFields : resource.key === 'departments' ? departmentFields : positionFields;
    const parsed = schema.safeParse(fields);
    if (!parsed.success) throw new NativeFormError(parsed.error.issues[0].message);
    const fresh = checkedOrganization(await api.get<unknown>('/organization-management', { signal }));
    const permitted = resource.key === 'companies' ? fresh.canCreateCompany : resource.key === 'units' ? fresh.companies.some(c => c.id === fields.companyId && c.canCreateUnit)
      : resource.key === 'positions' ? fresh.companies.some(c => c.id === fields.companyId && c.canCreatePosition) : fresh.units.some(u => u.id === fields.unitId && u.canCreateDepartment);
    if (!permitted) throw new NativeContextConflict('Os locais ou as permissões mudaram. Feche o formulário e atualize a consulta.');
    const expected: Record<string, unknown> = { ...parsed.data };
    for (const key of ['email', 'phone', 'description', 'cbo', 'complement']) if (expected[key] === '') expected[key] = null;
    const body = resource.key === 'companies' ? { ...expected, tipoEmpresa: fields.tipoEmpresa === 'INTERNA' ? 0 : 1 } : expected;
    const receiptSchema: z.ZodType<Record<string, unknown>> = resource.key === 'companies' ? companyReceipt : resource.key === 'units' ? unitReceipt : resource.key === 'departments' ? departmentReceipt : positionReceipt;
    let receipt: unknown;
    try { receipt = await api.post<unknown>(resource.path, body, { signal, idempotencyKey: undefined }); }
    catch (error) { if (error instanceof ApiError && error.status === 409) throw new NativeFormError('Já existe um cadastro com estes dados. Confira o CNPJ, o código ou o nome informado.'); throw error; }
    const saved = receiptSchema.safeParse(receipt);
    if (!saved.success || Object.entries(expected).some(([key, value]) => saved.data[key] !== value)) throw new InvalidReadResponse();
    const stored = receiptSchema.safeParse(await api.get<unknown>(`${resource.path}/${saved.data.id}`, { signal }));
    if (!stored.success || JSON.stringify(saved.data) !== JSON.stringify(stored.data)) throw new InvalidReadResponse();
  }
  function input(key: string, label: string, busy: boolean, maxLength = 150, required = true) {
    return <Field label={label} required={required}><input value={fields[key]} disabled={busy || Boolean(opening && key === 'cnpj')} maxLength={maxLength} onChange={event => change(key, event.target.value)}/></Field>;
  }
  return <NativeCommandDialog title={`${opening ? 'Editar' : 'Cadastrar'} ${resource.singular}`} dirty={dirty || Boolean(reason)} disabled={!dirty || Boolean(opening && !confirmed)} submitLabel={opening ? 'Salvar alterações' : 'Cadastrar'} onClose={onClose} onDone={onDone} perform={perform}>{busy => <>
    {resource.key === 'companies' ? <>
      {input('corporateName', 'Razão social', busy, 255)}{input('fantasyName', 'Nome fantasia', busy, 255)}
      <div className={styles.formGrid}>{input('cnpj', 'CNPJ', busy, 20)}<Field label="Tipo de empresa" required><select value={fields.tipoEmpresa} disabled={busy || Boolean(opening)} onChange={event => change('tipoEmpresa', event.target.value)}><option value="INTERNA">Interna</option><option value="PRESTADORA">Prestadora</option></select></Field></div>
      <div className={styles.formGrid}><Field label="E-mail"><input type="email" value={fields.email} disabled={busy} maxLength={200} onChange={event => change('email', event.target.value)}/></Field>{input('phone', 'Telefone', busy, 20, false)}</div>
    </> : <>
      {resource.key === 'departments' ? <Field label="Unidade" required><select value={fields.unitId} disabled={busy || Boolean(opening)} onChange={event => change('unitId', event.target.value)}><option value="">Selecione a unidade</option>{units.map(u => <option key={u.id} value={u.id}>{context.companies.find(c => c.id === u.companyId)?.name} · {u.name}</option>)}</select></Field>
        : <Field label="Empresa" required><select value={fields.companyId} disabled={busy || Boolean(opening)} onChange={event => change('companyId', event.target.value)}><option value="">Selecione a empresa</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
      {input('name', 'Nome', busy)}
      {resource.key === 'units' ? <>
        <div className={styles.formGrid}>{input('code', 'Código', busy, 50)}<Field label="Tipo de unidade" required><select value={fields.type} disabled={busy} onChange={event => change('type', event.target.value)}><option value="MATRIZ">Matriz</option><option value="FILIAL">Filial</option>{!['MATRIZ','FILIAL'].includes(fields.type) && <option value={fields.type}>{fields.type}</option>}</select></Field></div>
        <div className={styles.formGrid}>{input('cep', 'CEP', busy, 9)}{input('city', 'Cidade', busy, 120)}</div>
        <div className={styles.formGrid}><Field label="UF" required><select value={fields.state} disabled={busy} onChange={event => change('state', event.target.value)}><option value="">Selecione</option>{unitFields.shape.state.options.map(state => <option key={state}>{state}</option>)}</select></Field>{input('neighborhood', 'Bairro', busy, 100)}</div>
        {input('address', 'Endereço', busy, 200)}<div className={styles.formGrid}>{input('number', 'Número', busy, 20)}{input('complement', 'Complemento', busy, 100, false)}</div>
      </> : <>{resource.key === 'positions' && input('cbo', 'CBO', busy, 10, false)}<Field label="Descrição"><textarea value={fields.description} disabled={busy} maxLength={500} onChange={event => change('description', event.target.value)}/></Field></>}
    </>}
    {opening && <><Field label="Motivo da alteração" required><textarea maxLength={200} disabled={busy} value={reason} onChange={event => { setReason(event.target.value);confirm(false); }}/></Field><label className="check-label"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => confirm(event.target.checked)}/>Conferi as alterações deste cadastro.</label></>}
    {history}
  </>}</NativeCommandDialog>;
}
