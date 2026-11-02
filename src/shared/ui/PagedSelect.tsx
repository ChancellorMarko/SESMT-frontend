import { useEffect, useId, useState } from 'react';
import { Button, Feedback, Field } from './index';
import type { PagedLookup } from '../lib/use-paged-lookup';
import styles from './PagedSelect.module.css';

export function PagedSelect<T extends { id: string }>({ lookup, label, noun, value, onChange, getLabel, multiple = false, emptyLabel = 'Selecione uma opção', error, disabled = false, required }: {
  lookup: PagedLookup<T>;
  label: string;
  noun: string;
  value: string | string[];
  onChange: (value: string | string[]) => void;
  getLabel: (item: T) => string;
  multiple?: boolean;
  emptyLabel?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const searchId = useId();
  const [draft, setDraft] = useState(lookup.term);
  useEffect(() => { setDraft(lookup.term); }, [lookup.contextKey, lookup.term]);
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const pageIds = new Set(lookup.items.map(item => item.id));
  const retained = lookup.selectedItems.filter(item => selected.includes(item.id) && !pageIds.has(item.id));
  const knownIds = new Set([...lookup.items, ...lookup.selectedItems].map(item => item.id));
  const unresolved = selected.filter(id => !knownIds.has(id));
  const lastPage = Math.max(1, Math.ceil(lookup.total / lookup.pageSize));
  const tools = lookup.total > lookup.pageSize || lookup.page > 1 || Boolean(lookup.term) || Boolean(lookup.missingIds.length && !lookup.isPending);
  const blocked = disabled || lookup.isFetching || lookup.isError;
  const names = new Map([...lookup.items, ...lookup.selectedItems].map(item => [item.id, getLabel(item)]));
  function search() { if (!disabled && !lookup.isFetching) lookup.setTerm(draft); }

  return <div className={styles.root}>
    <Field label={label} error={error} required={required}>
      <select multiple={multiple} size={multiple ? 4 : undefined} value={multiple ? selected : selected[0] ?? ''} disabled={blocked}
        onChange={event => onChange(multiple ? Array.from(event.currentTarget.selectedOptions, option => option.value) : event.currentTarget.value)}>
        {!multiple && <option value="">{emptyLabel}</option>}
        {unresolved.map(id => <option key={id} value={id}>Selecionado; identificação indisponível: {id}</option>)}
        {retained.length > 0 && <optgroup label="Seleção atual">{retained.map(item => <option key={item.id} value={item.id}>{getLabel(item)}</option>)}</optgroup>}
        {lookup.items.map(item => <option key={item.id} value={item.id}>{getLabel(item)}</option>)}
      </select>
    </Field>
    {multiple && selected.length > 0 && <div className={styles.selected}>
      <span className="small" role="status">{selected.length} selecionado(s)</span>
      {selected.map(id => <span key={id} className={styles.selection}>
        <span>{names.get(id) ?? `Identificação indisponível: ${id}`}</span>
        <Button variant="ghost" disabled={blocked} aria-label={`Remover ${names.get(id) ?? id}`} onClick={() => onChange(selected.filter(value => value !== id))}>Remover</Button>
      </span>)}
    </div>}
    {lookup.isPending && <span className="muted" role="status">Carregando opções de {noun}…</span>}
    {lookup.isError && <Feedback tone="danger">
      <p>Não foi possível carregar opções de {noun}. Confira seu acesso e tente novamente.</p>
      <Button variant="secondary" disabled={disabled || lookup.isFetching} onClick={() => void lookup.refetch()}>Tentar carregar {noun} novamente</Button>
    </Feedback>}
    {!lookup.isPending && !lookup.isError && lookup.missingIds.length > 0 && <p className="muted">Alguns itens selecionados não estão disponíveis neste contexto. Confira os vínculos antes de salvar.</p>}
    {tools && <div className={styles.tools}>
      <label htmlFor={searchId} className="small">Buscar {noun}</label>
      <div className={styles.search}>
        <input id={searchId} type="search" value={draft} disabled={blocked} onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); search(); } }} />
        <Button variant="secondary" disabled={blocked} onClick={search}>Pesquisar {noun}</Button>
      </div>
      <nav className={styles.pagination} aria-label={`Paginação de ${noun}`}>
        <p className="muted" role="status">{lookup.total} opção(ões) · Página {lookup.page} de {lastPage}</p>
        <div className={styles.buttons}>
          <Button variant="ghost" disabled={blocked || lookup.page <= 1} onClick={() => lookup.setPage(Math.min(lookup.page - 1, lastPage))}>Anterior: {noun}</Button>
          <Button variant="ghost" disabled={blocked || lookup.page >= lastPage} onClick={() => lookup.setPage(lookup.page + 1)}>Próxima: {noun}</Button>
        </div>
      </nav>
    </div>}
  </div>;
}
