import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { nativeWorkerAccountApi } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { Button, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { nativeId } from '../native-operations/contracts';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { workerNavigation } from '../workers/worker-navigation';
import { checkedAccountCandidate, checkedAccountCandidates, checkedWorkerAccountContext, type AccountCandidate, type WorkerAccountContext } from './account-binding';
import styles from './NativeWorkerAccount.module.css';

export function NativeWorkerAccountPage() {
  const { id } = useParams(), { sessionKey, unitId } = useSession();
  return <Workspace key={`${sessionKey}:${unitId}:${id}`} id={id ?? ''}/>;
}
function Workspace({ id }: { id: string }) {
  const { me, unitId, sessionKey, can } = useSession(), client = useQueryClient(), navigate = useNavigate(), location = useLocation();
  const expected = { workerId: id, unitId: unitId ?? '', companyIds: me?.scope.companyIds ?? [] };
  const allowed = Boolean(me && !me.scope.ownOnly && ['workers.read', 'trabalhador:editar', 'usuario:ler', 'usuario:editar'].every(can));
  const valid = Boolean(nativeId.safeParse(id).success && unitId && me?.scope.unitIds.includes(unitId) && expected.companyIds.length);
  const context = useVerifiedRead({ queryKey: ['native-worker-account', sessionKey, unitId, id], enabled: allowed && valid,
    request: signal => nativeWorkerAccountApi.context<unknown>(id, signal), validate: value => checkedWorkerAccountContext(value, expected) });
  const origin = workerNavigation(location.state, sessionKey, unitId);
  const close = () => void navigate(`/app/trabalhadores/${id}`, { replace: true, state: origin });
  return <div className="stack"><PageHeader title="Conta de acesso"/>{!allowed ? <Feedback tone="warning">Seu acesso não permite vincular contas a trabalhadores.</Feedback>
    : !valid ? <Feedback tone="warning">Abra o trabalhador pela unidade autorizada.</Feedback>
    : context.isError ? <><Feedback tone="danger">Não foi possível conferir o vínculo e a autorização para administrar esta conta.</Feedback><Button variant="secondary" onClick={close}>Voltar ao trabalhador</Button></>
    : context.data ? context.data.userId ? <><Feedback>Este trabalhador já possui uma conta vinculada.</Feedback><Button variant="secondary" onClick={close}>Voltar ao trabalhador</Button></>
      : !context.data.active ? <><Feedback tone="warning">O vínculo profissional precisa estar ativo para associar uma conta.</Feedback><Button variant="secondary" onClick={close}>Voltar ao trabalhador</Button></>
      : <Editor initial={context.data} refreshing={context.isFetching} expected={expected} onClose={close} onDone={async () => {
        await Promise.all(['worker', 'workers', 'native-worker-account', 'native-opening'].map(key => client.invalidateQueries({ queryKey: [key, sessionKey] })));
        void navigate(`/app/trabalhadores/${id}`, { replace: true, state: { ...origin, success: 'Conta vinculada. O titular deve entrar novamente para atualizar sua identificação.' } });
      }}/>
    : context.isPending ? <Spinner/> : null}</div>;
}
function Editor({ initial, expected, refreshing, onClose, onDone }: { initial: WorkerAccountContext; expected: Parameters<typeof checkedWorkerAccountContext>[1]; refreshing: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const { sessionKey } = useSession(), [snapshot] = useState(initial), [q, setQ] = useState(''), [search, apply] = useState(''), [page, setPage] = useState(1);
  const [selected, select] = useState<AccountCandidate>(), [confirmed, confirm] = useState(false);
  const candidates = useVerifiedRead({ queryKey: ['native-worker-account-candidates', sessionKey, snapshot.workerId, snapshot.revision, search, page], scope: ['native-worker-account-candidates', sessionKey, snapshot.workerId], enabled: true,
    request: signal => nativeWorkerAccountApi.search<unknown>(snapshot.workerId, search, page, signal), validate: value => checkedAccountCandidates(value, snapshot, page) });
  function find() { if (search === q.trim() && page === 1) void candidates.refetch(); else { apply(q.trim()); setPage(1); } }
  async function perform(signal: AbortSignal) {
    if (!selected || !confirmed) throw new NativeFormError('Selecione a conta e confirme a identidade do titular.');
    const fresh = checkedWorkerAccountContext(await nativeWorkerAccountApi.context<unknown>(snapshot.workerId, signal), expected);
    if (JSON.stringify(fresh) !== JSON.stringify(snapshot)) throw new NativeContextConflict('O cadastro do trabalhador foi alterado. Seus dados foram mantidos; atualize a consulta antes de vincular.');
    const account = checkedAccountCandidate(await nativeWorkerAccountApi.candidate<unknown>(snapshot.workerId, selected.id, signal), selected.id);
    if (JSON.stringify(account) !== JSON.stringify(selected)) throw new NativeContextConflict('Os dados da conta foram alterados. Confira novamente a identidade do titular.');
    const receipt = checkedWorkerAccountContext(await nativeWorkerAccountApi.link<unknown>(snapshot.workerId, { expectedVersion: snapshot.revision, userId: account.id, expectedAccountName: account.name, expectedAccountEmail: account.email, confirmation: true }, signal), expected);
    const wanted = { ...snapshot, revision: snapshot.revision + 1, userId: account.id };
    if (JSON.stringify(receipt) !== JSON.stringify(wanted)) throw new InvalidReadResponse();
    const stored = checkedWorkerAccountContext(await nativeWorkerAccountApi.context<unknown>(snapshot.workerId, signal), expected);
    if (JSON.stringify(stored) !== JSON.stringify(receipt)) throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title="Vincular conta de acesso" dirty={Boolean(selected)} disabled={!selected || !confirmed || refreshing || candidates.isFetching || candidates.isError} submitLabel="Vincular conta" perform={perform} onClose={onClose} onDone={onDone}>{busy => <>
    <p><strong>{snapshot.name}</strong><br/><span className="muted">Matrícula {snapshot.enrollment}</span></p>
    <div className={styles.search}><Field label="Buscar conta por nome ou e-mail"><input maxLength={200} value={q} disabled={busy} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (!busy && !candidates.isFetching) find(); } }}/></Field><Button variant="secondary" disabled={busy || candidates.isFetching} onClick={find}>Buscar contas</Button></div>
    {candidates.isPending && <Spinner/>}{candidates.isError && <Feedback tone="danger">Não foi possível conferir as contas disponíveis.</Feedback>}
    {candidates.data && <><ul className={styles.accounts} aria-label="Contas disponíveis">{candidates.data.items.map(account => <li key={account.id}><label><input type="radio" name="account" disabled={busy} checked={selected?.id === account.id} onChange={() => { select(account); confirm(false); }}/><span><strong>{account.name}</strong>{' '}<small>{account.email}</small></span></label></li>)}</ul>
      {!candidates.data.items.length && <p>Nenhuma conta disponível para esta busca.</p>}
      {(page > 1 || candidates.data.total > 20) && <div className="actions"><Button variant="secondary" disabled={busy || candidates.isFetching || page === 1} onClick={() => setPage(p => p - 1)}>Anterior</Button><span>Página {page}</span><Button variant="secondary" disabled={busy || candidates.isFetching || page * 20 >= candidates.data.total} onClick={() => setPage(p => p + 1)}>Próxima</Button></div>}</>}
    {selected && <div className={styles.confirmation}><strong>{selected.name}</strong><span>{selected.email}</span><label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => confirm(e.target.checked)}/>Conferi que esta conta pertence ao trabalhador.</label></div>}
  </>}</NativeCommandDialog>;
}
