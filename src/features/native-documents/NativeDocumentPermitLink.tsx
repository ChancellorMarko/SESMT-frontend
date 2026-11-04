import { useState } from 'react';
import { api, nativeDocumentsApi } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { Button, Feedback, Field, Spinner } from '../../shared/ui';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checkedPermit, checkedPermits, permitCriteria, permitQuery, type NativePermit } from '../native-permits/contracts';
import { checkedDocument, type NativeDocument } from './contracts';

export function NativeDocumentPermitLink({ item, onClose, onDone }: { item: NativeDocument; onClose: () => void; onDone: () => Promise<void> }) {
  const { me, sessionKey, can } = useSession(), [q, setQ] = useState(''), [applied, apply] = useState(''), [page, setPage] = useState(1);
  const [selected, select] = useState<NativePermit>(), [confirmed, confirm] = useState(false);
  const allowed = Boolean(me && can('pt:editar') && can('documento:ler'));
  const criteria = permitCriteria(new URLSearchParams({ q: applied, page: String(page), companyId: item.companyId,
    ...(item.unitId ? { locationId: item.unitId } : {}), status: 'EM_VERIFICACAO' }));
  const permits = useVerifiedRead({ queryKey: ['native-document-link-options', sessionKey, item.id, criteria], scope: ['native-document-link-options', sessionKey, item.id], enabled: allowed && Boolean(criteria),
    request: signal => api.get<unknown>('/work-permits/search', { query: permitQuery(criteria!), signal }), validate: value => checkedPermits(value, criteria!) });
  async function perform(signal: AbortSignal) {
    if (!allowed || !me || !selected || !confirmed || permits.isFetching || !permits.data || !permits.data.items.some(p => p.id === selected.id)) throw new NativeFormError('Selecione uma PT e confirme o vínculo do documento.');
    const document = checkedDocument(await nativeDocumentsApi.get<unknown>(`/documents/${item.id}`, { signal }), item.id, me.scope);
    const permit = checkedPermit(await api.get<unknown>(`/work-permits/${selected.id}`, { signal }), selected.id);
    if (document.revision !== item.revision || document.companyId !== item.companyId || permit.companyId !== item.companyId
      || permit.version !== selected.version || permit.contentVersion !== selected.contentVersion || permit.status !== 'EM_VERIFICACAO')
      throw new NativeContextConflict('O documento ou a PT foi alterado. Atualize os registros antes de confirmar o vínculo.');
    const receipt = await api.post<unknown>(`/work-permits/${permit.id}/documents`, { documentId: item.id, expectedVersion: permit.version }, { signal, idempotencyKey: undefined });
    if (receipt !== undefined) throw new InvalidReadResponse();
    const updated = checkedPermit(await api.get<unknown>(`/work-permits/${permit.id}`, { signal }), permit.id);
    if (updated.companyId !== permit.companyId || updated.appointmentId !== permit.appointmentId || updated.status !== permit.status
      || updated.version !== permit.version + 1 || updated.contentVersion !== permit.contentVersion + 1) throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title="Vincular documento à PT" dirty={Boolean(selected || confirmed)} disabled={!allowed || !permits.data || permits.isFetching || permits.isError}
    submitLabel="Confirmar vínculo" perform={perform} onClose={onClose} onDone={onDone}>{busy => <>
    <p>{item.title} · {item.code}</p><Field label="Buscar PT em verificação"><input value={q} maxLength={200} disabled={busy} onChange={e => setQ(e.target.value)}/></Field>
    <Button variant="secondary" disabled={busy || permits.isFetching} onClick={() => { apply(q.trim()); setPage(1); select(undefined); confirm(false); }}>Buscar PTs</Button>
    {permits.isPending && <Spinner/>}{permits.isError && <Feedback tone="danger">Não foi possível consultar as PTs disponíveis para este vínculo.</Feedback>}
    <Field label="Permissão de trabalho" required><select value={selected?.id ?? ''} disabled={busy || permits.isFetching || !permits.data} onChange={e => { select(permits.data?.items.find(p => p.id === e.target.value)); confirm(false); }}><option value="">Selecione</option>{permits.data?.items.map(p => <option key={p.id} value={p.id}>{p.title} · {p.serviceCode}</option>)}</select></Field>
    {permits.data && <div className="actions"><Button variant="secondary" disabled={busy || permits.isFetching || page <= 1} onClick={() => { setPage(p => p - 1); select(undefined); }}>Anterior</Button><span>Página {page}</span><Button variant="secondary" disabled={busy || permits.isFetching || page * permits.data.pageSize >= permits.data.total} onClick={() => { setPage(p => p + 1); select(undefined); }}>Próxima</Button></div>}
    <Feedback>O vínculo não libera a atividade. A API reavalia a documentação; as ciências precisam corresponder à nova versão do conteúdo.</Feedback>
    <label><input type="checkbox" checked={confirmed} disabled={busy || !selected} onChange={e => confirm(e.target.checked)}/> Confirmo este documento e a PT selecionada.</label>
  </>}</NativeCommandDialog>;
}
