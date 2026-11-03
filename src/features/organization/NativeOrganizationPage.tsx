import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { checkedOrganization, organizationResources, type NativeOrganization, type OrganizationResource } from './native-organization';
import { NativeOrganizationCreate } from './NativeOrganizationCreate';
import { NativeOrganizationEdit, type OrganizationEditTarget } from './NativeOrganizationEdit';
import styles from './NativeOrganizationPage.module.css';

export function NativeOrganizationPage() {
  const { sessionKey, can } = useSession();
  return <Workspace key={`${sessionKey}:${can('organization.read')}`}/>;
}
function Workspace() {
  const { sessionKey, can, restore } = useSession(), client = useQueryClient();
  const [resource, setResource] = useState<OrganizationResource>('companies'), [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false), [success, setSuccess] = useState('');
  const [editing,setEditing] = useState<OrganizationEditTarget>();
  const snapshot = useVerifiedRead({ queryKey: ['native-organization-management', sessionKey], enabled: can('organization.read'),
    request: signal => api.get<unknown>('/organization-management', { signal }), validate: checkedOrganization });
  const data = snapshot.data, selected = organizationResources.find(item => item.key === resource)!;
  const allowCreate = data && can(selected.permission) && (resource === 'companies' ? data.canCreateCompany : resource === 'units' ? data.companies.some(c => c.canCreateUnit) : resource === 'positions' ? data.companies.some(c => c.canCreatePosition) : data.units.some(u => u.canCreateDepartment));
  const rows = data?.[resource].filter(row => `${row.name} ${'code' in row ? row.code : ''} ${parentName(row, data)}`.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR'))) ?? [];
  async function completed() {
    const updated = Boolean(editing);
    setCreating(false); setEditing(undefined); setSuccess(editing ? 'Cadastro atualizado.' : 'Cadastro concluído.');
    await Promise.all([client.invalidateQueries({ queryKey: ['native-organization-management'] }), client.invalidateQueries({ queryKey: ['organization'] }), client.invalidateQueries({ queryKey: ['native-organization-edit'] })]);
    // Creation can expand the scope catalog. Editing preserves its IDs and selected unit.
    if (!updated) await restore();
  }
  return <div className="stack"><PageHeader title="Organização" description="Cadastre empresas, unidades, setores e cargos usados nas contas e nos documentos." actions={<><Button variant="secondary" disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()}>Atualizar</Button>{allowCreate && <Button disabled={snapshot.isFetching} onClick={() => { setSuccess(''); setCreating(true); }}>Cadastrar {selected.singular}</Button>}</>}/>
    {success && <Feedback tone="success">{success}</Feedback>}
    <div className={styles.toolbar}><div role="group" aria-label="Cadastros da organização" className={styles.tabs}>{organizationResources.map(item => <button type="button" aria-pressed={resource === item.key} key={item.key} onClick={() => { setResource(item.key); setSearch(''); setSuccess(''); }}>{item.label}{data && <Badge>{data[item.key].length}</Badge>}</button>)}</div><Field label="Buscar cadastro"><input type="search" value={search} maxLength={200} onChange={event => setSearch(event.target.value)}/></Field></div>
    {snapshot.isPending ? <Spinner/> : snapshot.isError ? <Feedback tone="danger">Não foi possível consultar a estrutura autorizada. Atualize a consulta ou confira os acessos da conta.</Feedback> : data && <section className={styles.results} aria-label={selected.label}>
      {!rows.length ? <EmptyState title={`Nenhum cadastro encontrado em ${selected.label.toLocaleLowerCase('pt-BR')}`} description={search ? 'Ajuste os termos da busca.' : 'Cadastre a estrutura da organização para associar pessoas e documentos.'}/> : <div className={styles.scroll} role="region" aria-label={`Tabela de ${selected.label.toLocaleLowerCase('pt-BR')}`} tabIndex={0}><table className="data-table"><thead><tr><th scope="col">{selected.singular === 'empresa' ? 'Empresa' : 'Nome'}</th>{resource !== 'companies' && <th scope="col">Vínculo</th>}<th scope="col">Situação</th>{rows.some(r=>r.canEdit) && can(selected.editPermission) && <th scope="col">Ações</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><strong>{row.name}</strong>{'code' in row && <span className={styles.code}>{row.code}</span>}</td>{resource !== 'companies' && <td>{parentName(row, data)}</td>}<td><Badge tone="success">Ativo</Badge></td>{rows.some(r=>r.canEdit) && can(selected.editPermission) && <td>{row.canEdit && <Button variant="secondary" aria-label={`Editar ${selected.singular} ${row.name}`} onClick={()=>{
        const unit = 'unitId' in row ? row.unitId : resource==='units'?row.id:null;
        const company = 'companyId' in row ? row.companyId : unit?data.units.find(u=>u.id===unit)?.companyId:row.id;
        if(company) {setSuccess('');setEditing({id:row.id,companyId:company,unitId:unit});}
      }}>Editar</Button>}</td>}</tr>)}</tbody></table></div>}
    </section>}
    {creating && data && allowCreate && <NativeOrganizationCreate key={resource} resource={selected} context={data} onClose={() => setCreating(false)} onDone={completed}/>}
    {editing && data && <NativeOrganizationEdit key={`${resource}:${editing.id}`} target={editing} resource={selected} context={data} onClose={()=>setEditing(undefined)} onDone={completed}/>}
  </div>;
}
function parentName(row: { id: string; name: string; companyId?: string; unitId?: string }, data: NativeOrganization) {
  if (row.unitId) { const unit = data.units.find(u => u.id === row.unitId); return `${data.companies.find(c => c.id === unit?.companyId)?.name ?? ''} / ${unit?.name ?? ''}`; }
  return row.companyId ? data.companies.find(c => c.id === row.companyId)?.name ?? '' : 'Empresa';
}
