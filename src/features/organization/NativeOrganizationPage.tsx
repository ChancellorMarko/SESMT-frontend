import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { checkedOrganization, organizationResources, type NativeOrganization, type OrganizationResource } from './native-organization';
import { NativeOrganizationCreate } from './NativeOrganizationCreate';
import styles from './NativeOrganizationPage.module.css';

export function NativeOrganizationPage() {
  const { sessionKey, can } = useSession();
  return <Workspace key={`${sessionKey}:${can('organization.read')}`}/>;
}
function Workspace() {
  const { sessionKey, can, restore } = useSession(), client = useQueryClient();
  const [resource, setResource] = useState<OrganizationResource>('companies'), [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false), [success, setSuccess] = useState('');
  const snapshot = useVerifiedRead({ queryKey: ['native-organization-management', sessionKey], enabled: can('organization.read'),
    request: signal => api.get<unknown>('/organization-management', { signal }), validate: checkedOrganization });
  const data = snapshot.data, selected = organizationResources.find(item => item.key === resource)!;
  const allowCreate = data && can(selected.permission) && (resource === 'companies' ? data.canCreateCompany : resource === 'units' ? data.companies.some(c => c.canCreateUnit) : resource === 'positions' ? data.companies.some(c => c.canCreatePosition) : data.units.some(u => u.canCreateDepartment));
  const rows = data?.[resource].filter(row => `${row.name} ${'code' in row ? row.code : ''} ${parentName(row, data)}`.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR'))) ?? [];
  async function completed() {
    setCreating(false); setSuccess('Cadastro concluído.');
    await Promise.all([client.invalidateQueries({ queryKey: ['native-organization-management'] }), client.invalidateQueries({ queryKey: ['organization'] })]);
    // A newly created company/unit changes the global administrator's scope catalog.
    await restore();
  }
  return <div className="stack"><PageHeader title="Organização" description="Cadastre empresas, unidades, setores e cargos usados nas contas e nos documentos." actions={<><Button variant="secondary" disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()}>Atualizar</Button>{allowCreate && <Button disabled={snapshot.isFetching} onClick={() => { setSuccess(''); setCreating(true); }}>Cadastrar {selected.singular}</Button>}</>}/>
    {success && <Feedback tone="success">{success}</Feedback>}
    <div className={styles.toolbar}><div role="group" aria-label="Cadastros da organização" className={styles.tabs}>{organizationResources.map(item => <button type="button" aria-pressed={resource === item.key} key={item.key} onClick={() => { setResource(item.key); setSearch(''); setSuccess(''); }}>{item.label}{data && <Badge>{data[item.key].length}</Badge>}</button>)}</div><Field label="Buscar cadastro"><input type="search" value={search} maxLength={200} onChange={event => setSearch(event.target.value)}/></Field></div>
    {snapshot.isPending ? <Spinner/> : snapshot.isError ? <Feedback tone="danger">Não foi possível consultar a estrutura autorizada. Atualize a consulta ou confira os acessos da conta.</Feedback> : data && <section className={styles.results} aria-label={selected.label}>
      {!rows.length ? <EmptyState title={`Nenhum cadastro encontrado em ${selected.label.toLocaleLowerCase('pt-BR')}`} description={search ? 'Ajuste os termos da busca.' : 'Cadastre a estrutura da organização para associar pessoas e documentos.'}/> : <div className={styles.scroll}><table className="data-table"><thead><tr><th scope="col">{selected.singular === 'empresa' ? 'Empresa' : 'Nome'}</th>{resource !== 'companies' && <th scope="col">Vínculo</th>}<th scope="col">Situação</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><strong>{row.name}</strong>{'code' in row && <span className={styles.code}>{row.code}</span>}</td>{resource !== 'companies' && <td>{parentName(row, data)}</td>}<td><Badge tone="success">Ativo</Badge></td></tr>)}</tbody></table></div>}
    </section>}
    {creating && data && allowCreate && <NativeOrganizationCreate key={resource} resource={selected} context={data} onClose={() => setCreating(false)} onDone={completed}/>}
  </div>;
}
function parentName(row: { id: string; name: string; companyId?: string; unitId?: string }, data: NativeOrganization) {
  if (row.unitId) { const unit = data.units.find(u => u.id === row.unitId); return `${data.companies.find(c => c.id === unit?.companyId)?.name ?? ''} / ${unit?.name ?? ''}`; }
  return row.companyId ? data.companies.find(c => c.id === row.companyId)?.name ?? '' : 'Empresa';
}
