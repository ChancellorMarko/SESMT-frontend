import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { SignatureRepresentationDto, SignatureRepresentationMethod, SignatureRepresentationWriteDto } from '../../shared/contracts/signature-representation';
import { isSignatureImageRepresentation, SIGNATURE_IMAGE_MAX_FILE_BYTES } from '../../shared/lib/signature-image';
import { formatDate } from '../../shared/lib/format';
import { Button, EmptyState, Feedback, PageHeader, Spinner } from '../../shared/ui';
import { SignaturePad } from '../permits/SignaturePad';
import { UnsavedChanges } from '../workers/UnsavedChanges';
import styles from './SignatureProfile.module.css';

export function SignatureProfilePage() {
  const { can, me, sessionKey, unitId } = useSession();
  if (!can('permits.review') || !me) return <EmptyState title="Acesso restrito" description="Somente responsáveis pela revisão podem gerenciar sua própria representação." />;
  return <PersonalProfile key={`${sessionKey}:${unitId}`} userId={me.user.id} name={me.user.displayName} sessionKey={sessionKey} unitId={unitId} />;
}
function PersonalProfile({ userId, name, sessionKey, unitId }: { userId: string; name: string; sessionKey: string; unitId?: string }) {
  const client = useQueryClient();
  const queryKey = ['signature-representation', sessionKey, unitId];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => api.get<SignatureRepresentationDto | null>('/me/signature-representation', { signal }), refetchOnWindowFocus: true });
  const [draft, setDraft] = useState<{ method: SignatureRepresentationMethod; image: string; revision: number }>();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false); const [reading, setReading] = useState(false); const [reloading, setReloading] = useState(false);
  const [fileName, setFileName] = useState(''); const [padKey, setPadKey] = useState(0);
  const reader = useRef<FileReader | null>(null); const request = useRef<AbortController | null>(null);
  const mounted = useRef(true); const reloadPending = useRef(false);
  const profile = query.data?.userId === userId ? query.data : null;
  useEffect(() => {
    if (query.isSuccess && !draft && (!query.data || query.data.userId === userId)) setDraft({ method: profile?.method || 'TYPED', image: profile?.image || '', revision: profile?.revision || 0 });
  }, [query.isSuccess, query.data, draft, userId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); request.current = null; cancelRead(); }; }, []);
  const dirty = Boolean(draft && (draft.method !== (profile?.method || 'TYPED') || draft.image !== (profile?.image || '')));
  const conflict = Boolean(draft && query.isSuccess && draft.revision !== (profile?.revision || 0));
  const busy = pending || reading || reloading;
  function cancelRead() { const active = reader.current; reader.current = null; if (active?.readyState === FileReader.LOADING) active.abort(); }
  function changeMethod(method: SignatureRepresentationMethod) {
    if (busy || !draft) return;
    cancelRead(); setDraft({ ...draft, method, image: '' }); setConfirmed(false); setError(''); setNotice(''); setFileName(''); setPadKey(value => value + 1);
  }
  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    if (pending || reloading || !draft) return;
    cancelRead(); setReading(false); setDraft({ ...draft, image: '' }); setConfirmed(false); setError(''); setNotice(''); setFileName('');
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setError('Selecione uma imagem PNG ou JPEG.'); event.target.value = ''; return; }
    if (!file.size || file.size > SIGNATURE_IMAGE_MAX_FILE_BYTES) { setError('A imagem deve conter dados e ter até 2 MB.'); event.target.value = ''; return; }
    const active = new FileReader(); reader.current = active; setReading(true);
    active.onload = () => {
      if (reader.current !== active) return;
      reader.current = null; setReading(false);
      const image = typeof active.result === 'string' ? active.result : '';
      if (!isSignatureImageRepresentation(image)) { setError('Não foi possível ler uma imagem PNG ou JPEG válida.'); return; }
      setDraft(value => value ? { ...value, image } : value); setFileName(file.name);
    };
    active.onerror = () => { if (reader.current !== active) return; reader.current = null; setReading(false); setError('Não foi possível ler a imagem. Selecione o arquivo novamente.'); };
    active.readAsDataURL(file);
  }
  async function reload() {
    if (busy || reloadPending.current || dirty && !window.confirm('Carregar o perfil atual descarta suas alterações locais. Continuar?')) return;
    reloadPending.current = true; setReloading(true);
    try {
      const result = await query.refetch();
      if (!mounted.current || !result.isSuccess || result.data && result.data.userId !== userId) return;
      setDraft({ method: result.data?.method || 'TYPED', image: result.data?.image || '', revision: result.data?.revision || 0 });
      setError(''); setNotice(''); setConfirmed(false); setFileName(''); setPadKey(value => value + 1);
    } finally { reloadPending.current = false; if (mounted.current) setReloading(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (request.current || busy || reloadPending.current || !draft) return;
    setError(''); setNotice('');
    if (!confirmed) { setError('Confirme o salvamento da sua representação pessoal.'); return; }
    if (query.isError || query.isFetching || conflict || query.data && query.data.userId !== userId) { setError('Carregue e confira o perfil atual antes de salvar. Seu preenchimento foi preservado.'); return; }
    if (draft.method !== 'TYPED' && !isSignatureImageRepresentation(draft.image)) { setError(draft.method === 'DRAWN' ? 'Desenhe sua representação antes de salvar.' : 'Selecione uma imagem PNG ou JPEG válida antes de salvar.'); return; }
    const payload: SignatureRepresentationWriteDto = { method: draft.method, representation: name, ...(draft.method !== 'TYPED' ? { image: draft.image } : {}), confirmed: true };
    const controller = new AbortController(); request.current = controller; setPending(true);
    try {
      // Zero is the creation precondition for an absent profile, not an edit revision.
      const etag = !profile && draft.revision === 0 ? '"0"' : revisionEtag(draft.revision);
      const saved = await api.put<SignatureRepresentationDto>('/me/signature-representation', payload, { etag, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (saved.userId !== userId || saved.revision <= draft.revision || saved.representation !== name || saved.method !== payload.method || saved.image !== payload.image) throw new Error('A resposta não corresponde ao seu perfil. Seu preenchimento foi preservado.');
      client.setQueryData(queryKey, saved); setDraft({ method: saved.method, image: saved.image || '', revision: saved.revision }); setConfirmed(false);
      setNotice(`Representação pessoal salva na versão ${saved.version}. Nenhuma PT foi aprovada por esta ação.`);
      void client.invalidateQueries({ queryKey: ['signature-representation'] });
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Não foi possível salvar. Seu preenchimento foi preservado.'); }
    finally { if (request.current === controller) { request.current = null; setPending(false); } }
  }
  if (query.isPending && !draft) return <Spinner />;
  if (query.isError && !draft) return <div className="panel stack"><Feedback tone="danger">Não foi possível carregar sua representação.</Feedback><Button onClick={() => void query.refetch()}>Tentar novamente</Button></div>;
  if (query.data && query.data.userId !== userId) return <Feedback tone="danger">A representação retornada não pertence ao usuário autenticado.</Feedback>;
  if (!draft) return <Spinner />;
  return <div className="stack">
    <PageHeader title="Minha representação" description="Salve uma representação pessoal para reutilizar ao revisar o encerramento de uma PT." />
    <UnsavedChanges dirty={dirty} busy={busy} protectContext />
    <form className={`panel stack ${styles.form}`} onSubmit={save}>
      <Feedback tone="info">Salvar este perfil não aprova documentos. Cada aprovação exige conferir a versão da PT e confirmar a decisão. As versões já revisadas preservam a representação registrada naquele momento.</Feedback>
      {error && <Feedback tone="danger">{error}</Feedback>}{notice && <Feedback tone="success">{notice}</Feedback>}
      {(query.isError || conflict) && <Feedback tone="warning">O perfil precisa ser atualizado. Seu preenchimento foi preservado.</Feedback>}
      <p>Responsável autenticado: <strong>{name}</strong></p>
      <p className="muted">{profile ? `Perfil salvo · versão ${profile.version} · ${formatDate(profile.updatedAt)}` : 'Você ainda não possui uma representação pessoal salva.'}</p>
      <fieldset className={styles.choices} disabled={busy}><legend>Forma da representação pessoal</legend>{([['TYPED', 'Nome digitado'], ['DRAWN', 'Desenho'], ['IMAGE', 'Upload de imagem']] as const).map(([method, label]) => <label key={method}><input type="radio" name="profile-method" checked={draft.method === method} onChange={() => changeMethod(method)} />{label}</label>)}</fieldset>
      {draft.method === 'DRAWN' && <><SignaturePad key={padKey} disabled={busy} onChange={image => { setDraft(value => value ? { ...value, image } : value); setConfirmed(false); setNotice(''); }} /><p className="muted">Para substituir um desenho salvo, desenhe no quadro ou altere a forma de representação.</p></>}
      {draft.method === 'IMAGE' && <label>Imagem pessoal (PNG/JPEG até 2 MB)<input type="file" aria-label="Imagem da representação pessoal" accept="image/png,image/jpeg" disabled={pending || reloading} onChange={selectImage} />{fileName && <small>Arquivo selecionado: {fileName}</small>}{reading && <span role="status">Lendo a imagem selecionada…</span>}</label>}
      <div className={styles.preview}><p>Prévia da representação pessoal:</p>{draft.method === 'TYPED' ? <p className={styles.name}>{name}</p> : draft.image ? <img src={draft.image} alt="Prévia da representação pessoal" onError={() => { setDraft(value => value ? { ...value, image: '' } : value); setConfirmed(false); setError('A imagem não pode ser exibida. Escolha outro PNG ou JPEG.'); }} /> : <p className="muted">Representação visual pendente</p>}</div>
      <p className="muted">Esta representação visual não constitui certificado ICP-Brasil ou assinatura digital certificada.</p>
      <label className={styles.confirmation}><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>Confirmo que esta é minha representação pessoal e desejo salvá-la para uso em decisões futuras.</span></label>
      <div className="actions"><Button type="submit" disabled={busy || query.isFetching}>{pending ? 'Salvando…' : 'Salvar representação pessoal'}</Button><Button variant="secondary" disabled={busy || query.isFetching} onClick={() => void reload()}>Carregar perfil atual</Button></div>
    </form>
  </div>;
}
