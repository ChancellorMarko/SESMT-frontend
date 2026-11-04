import { useState } from 'react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { formatDate } from '../../shared/lib/format';
import { Button, Feedback, Field, InfoButton, Spinner } from '../../shared/ui';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checkedPermit, checkedScienceParticipant, same, type NativePermit } from './contracts';
import { checkedScience } from './science';
import styles from '../../shared/ui/NativeRecords.module.css';

export function NativePermitScience({ item, refreshing, onDone }: { item: NativePermit; refreshing: boolean; onDone: () => Promise<void> }) {
  const { me } = useSession();
  const [editing, edit] = useState<NativePermit>();
  const self = me && item.participants.find(person => person.userId === me.user.id);
  if (!me || !self || item.status !== 'EM_VERIFICACAO') return null;
  const recorded = self.acknowledgedVersion === item.contentVersion && Boolean(self.acknowledgedAt);
  return <section className="panel stack" aria-label="Sua ciência da PT"><div className="actions"><h2>Sua ciência</h2>
    {!recorded && <Button disabled={refreshing} onClick={() => edit(item)}>Registrar minha ciência</Button>}</div>
    <p>{recorded ? 'Sua ciência está registrada para o conteúdo atual.' : 'Confira as declarações e o contexto da atividade antes de confirmar sua ciência.'}</p>
    {editing && <ScienceDialog item={editing} user={me.user} onClose={() => edit(undefined)} onDone={async () => { edit(undefined); await onDone(); }}/ >}
  </section>;
}

function ScienceDialog({ item, user, onClose, onDone }: { item: NativePermit; user: { id: string; displayName: string }; onClose: () => void; onDone: () => Promise<void> }) {
  const { sessionKey } = useSession(), [name, setName] = useState(user.displayName.length <= 160 ? user.displayName : ''), [confirmed, confirm] = useState(false);
  const statement = useVerifiedRead({ queryKey: ['native-science', sessionKey, item.id, item.version], enabled: true,
    request: signal => api.get<unknown>(`/work-permits/${item.id}/declarations`, { signal }), validate: value => checkedScience(value, item) });
  async function perform(signal: AbortSignal) {
    if (!name.trim() || name.trim().length > 160 || !confirmed) throw new NativeFormError('Confira o nome e confirme a leitura das declarações e do contexto.');
    if (!statement.data || statement.isFetching || statement.isError) throw new NativeFormError('Atualize a PT antes de registrar a ciência.');
    const fresh = checkedPermit(await api.get<unknown>(`/work-permits/${item.id}`, { signal }), item.id);
    if (fresh.version !== item.version || fresh.contentVersion !== item.contentVersion || fresh.status !== 'EM_VERIFICACAO'
      || !fresh.participants.some(person => person.userId === user.id)) throw new NativeContextConflict('A PT foi alterada. Atualize o registro e leia novamente o conteúdo antes de confirmar.');
    const current = checkedScience(await api.get<unknown>(`/work-permits/${item.id}/declarations`, { signal }), item);
    if (current.contentHash !== statement.data.contentHash || current.canonicalContent !== statement.data.canonicalContent)
      throw new NativeContextConflict('As declarações ou o contexto mudaram. Atualize a PT para ler e confirmar o novo conteúdo.');
    const receipt = checkedScienceParticipant(await api.post<unknown>(`/work-permits/${item.id}/acknowledge`, {
      expectedVersion: item.version, contentVersion: item.contentVersion, participantUserId: user.id,
      confirmedName: name.trim(), identificationMethod: 'Sessão autenticada', confirmation: true, contentHash: current.contentHash,
    }, { signal, idempotencyKey: undefined }), item, user.id, name.trim(), current.canonicalContent);
    const updated = checkedPermit(await api.get<unknown>(`/work-permits/${item.id}`, { signal }), item.id);
    if (updated.companyId !== item.companyId || updated.version !== item.version + 1 || updated.contentVersion !== item.contentVersion
      || updated.status !== item.status || !same(updated.templateVersionIds, item.templateVersionIds)
      || JSON.stringify(updated.participants.find(person => person.userId === user.id)) !== JSON.stringify(receipt)) throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title="Registrar minha ciência" dirty={confirmed || name !== user.displayName} disabled={!statement.data || statement.isError || statement.isFetching}
    submitLabel="Confirmar minha ciência" onClose={onClose} onDone={onDone} perform={perform}>{busy => <>
    {statement.isPending && <Spinner/>}{statement.isError && <Feedback tone="danger">Não foi possível conferir o conteúdo integral. Feche esta janela e atualize a PT.</Feedback>}
    {statement.data && <><h3>{item.title}</h3><dl className={styles.details}><dt>Período</dt><dd>{formatDate(statement.data.context.from)} a {formatDate(statement.data.context.until)}</dd><dt>Serviços</dt><dd>{statement.data.context.serviceCodes.join(' · ')}</dd><dt>Versão do conteúdo</dt><dd>{item.contentVersion}</dd></dl>
      {statement.data.declarations.map(record => <section key={record.templateVersionId}><h3>Declaração · versão {record.version}</h3><p className={styles.message}>{record.text}</p></section>)}
      <InfoButton title="Contexto integral da ciência"><dl className={styles.details}><dt>PT</dt><dd>{item.id}</dd><dt>Agendamento e versão</dt><dd>{statement.data.context.appointmentId} · {statement.data.context.version}</dd><dt>Local</dt><dd>{statement.data.context.locationId ?? 'Não informado'}</dd><dt>Equipe</dt><dd>{statement.data.context.teamId ?? 'Não informada'}</dd><dt>Responsável</dt><dd>{statement.data.context.responsibleId ?? 'Não informado'}</dd><dt>Participantes do agendamento</dt><dd>{statement.data.context.participantIds.join(' · ')}</dd><dt>Modelos e versões</dt><dd>{statement.data.declarations.map(r => `${r.templateId} / ${r.version}`).join(' · ')}</dd></dl></InfoButton>
    </>}
    <Field label="Seu nome completo"><input value={name} maxLength={160} disabled={busy} onChange={event => setName(event.target.value)}/></Field>
    <label><input type="checkbox" checked={confirmed} disabled={busy || !statement.data} onChange={event => confirm(event.target.checked)}/> Li as declarações e o contexto desta atividade e confirmo minha ciência.</label>
  </>}</NativeCommandDialog>;
}
