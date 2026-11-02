import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Field } from './index';

describe('obrigatoriedade acessível dos campos', () => {
  it.each(['text', 'email', 'number', 'date', 'tel', 'url'])('anuncia o input %s marcado sem acrescentar validação nativa', type => {
    render(<Field label="Dado obrigatório *"><input type={type} /></Field>);

    const input = screen.getByLabelText('Dado obrigatório *', { exact: true });
    expect(input).toHaveAccessibleName('Dado obrigatório *');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).not.toHaveAttribute('required');
  });

  it('aplica a semântica ao select e à textarea preservando seus nomes', () => {
    render(<>
      <Field label="Unidade *"><select defaultValue=""><option value="">Selecione</option><option value="a">Unidade A</option></select></Field>
      <Field label="Descrição *"><textarea /></Field>
    </>);

    for (const control of [screen.getByRole('combobox', { name: 'Unidade *' }), screen.getByRole('textbox', { name: 'Descrição *' })]) {
      expect(control).toHaveAttribute('aria-required', 'true');
      expect(control).not.toHaveAttribute('required');
    }
  });

  it('aceita obrigatoriedade explícita quando o rótulo não contém asterisco', () => {
    render(<Field label="Prazo" required><input type="date" /></Field>);

    const input = screen.getByLabelText('Prazo', { exact: true });
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).not.toHaveAttribute('required');
  });

  it('mantém os campos opcionais sem indicação de obrigatoriedade', () => {
    render(<Field label="Complemento"><input /></Field>);

    const input = screen.getByRole('textbox', { name: 'Complemento' });
    expect(input).not.toHaveAttribute('aria-required', 'true');
    expect(input).not.toHaveAttribute('required');
  });

  it('permite desligar a inferência sem reescrever o rótulo existente', () => {
    render(<Field label="Referência *" required={false}><input /></Field>);

    const input = screen.getByRole('textbox', { name: 'Referência *' });
    expect(input).toHaveAccessibleName('Referência *');
    expect(input).not.toHaveAttribute('aria-required', 'true');
    expect(input).not.toHaveAttribute('required');
  });

  it('respeita aria-required explícito do controle nos dois sentidos', () => {
    render(<>
      <Field label="Referência *" required><input aria-required={false} /></Field>
      <Field label="Nome" required={false}><input aria-required="true" /></Field>
    </>);

    expect(screen.getByRole('textbox', { name: 'Referência *' })).toHaveAttribute('aria-required', 'false');
    expect(screen.getByRole('textbox', { name: 'Nome' })).toHaveAttribute('aria-required', 'true');
  });

  it('preserva a obrigatoriedade nativa que o próprio controle já definiu', () => {
    render(<Field label="Código" required={false}><input required /></Field>);

    const input = screen.getByRole('textbox', { name: 'Código' });
    expect(input).toHaveAttribute('required');
    expect(input).toBeRequired();
  });

  it('descreve a obrigação do arquivo sem usar aria-required em seu botão', () => {
    render(<><p id="formatos">Envie um PDF.</p><Field label="Documento *"><input id="documento" type="file" aria-describedby="formatos" /></Field></>);

    const input = screen.getByLabelText('Documento *', { exact: true });
    expect(input).toHaveAttribute('id', 'documento');
    expect(input).not.toHaveAttribute('aria-required');
    expect(input).not.toHaveAttribute('required');
    expect(input).toHaveAccessibleDescription('Envie um PDF. Campo obrigatório.');
  });

  it('retira o erro corrigido e mantém a ajuda e a obrigação do arquivo', () => {
    const { rerender } = render(<>
      <p id="ajuda-anexo">Tamanho máximo de 10 MB.</p>
      <Field label="Anexo *" error="Escolha um arquivo válido."><input id="anexo" type="file" aria-describedby="ajuda-anexo" /></Field>
    </>);
    const input = screen.getByLabelText('Anexo *', { exact: true });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/Tamanho máximo de 10 MB\./);
    expect(input).toHaveAccessibleDescription(/Campo obrigatório\./);
    expect(input).toHaveAccessibleDescription(/Escolha um arquivo válido\./);

    rerender(<>
      <p id="ajuda-anexo">Tamanho máximo de 10 MB.</p>
      <Field label="Anexo *"><input id="anexo" type="file" aria-describedby="ajuda-anexo" /></Field>
    </>);

    expect(input).not.toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Tamanho máximo de 10 MB. Campo obrigatório.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    for (const id of input.getAttribute('aria-describedby')!.split(/\s+/)) expect(document.getElementById(id)).not.toBeNull();
  });

  it('gera ids únicos de controle e de ajuda para dois arquivos obrigatórios', () => {
    render(<>
      <Field label="Documento pessoal *"><input type="file" /></Field>
      <Field label="Comprovante *"><input type="file" /></Field>
    </>);

    const first = screen.getByLabelText('Documento pessoal *', { exact: true });
    const second = screen.getByLabelText('Comprovante *', { exact: true });
    expect(first.id).toBeTruthy();
    expect(second.id).not.toBe(first.id);
    expect(first.getAttribute('aria-describedby')).toBeTruthy();
    expect(second.getAttribute('aria-describedby')).not.toBe(first.getAttribute('aria-describedby'));
    expect(first).toHaveAccessibleDescription('Campo obrigatório.');
    expect(second).toHaveAccessibleDescription('Campo obrigatório.');
  });

  it('aplica a obrigação à senha aninhada e deixa seu botão auxiliar intacto', () => {
    render(<Field label="Senha *"><span><input type="password" /><button type="button">Mostrar senha</button></span></Field>);

    expect(screen.getByLabelText('Senha *', { exact: true })).toHaveAttribute('aria-required', 'true');
    const button = screen.getByRole('button', { name: 'Mostrar senha' });
    expect(button).not.toHaveAttribute('aria-required');
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(button).not.toHaveAttribute('required');
  });

  it('preserva disabled e readOnly sem introduzir bloqueios de validação nativa', () => {
    render(<>
      <Field label="Unidade *"><select disabled><option value="a">Unidade A</option></select></Field>
      <Field label="Protocolo *"><input readOnly value="PT-1" /></Field>
    </>);

    const select = screen.getByRole('combobox', { name: 'Unidade *' });
    const input = screen.getByRole('textbox', { name: 'Protocolo *' });
    expect(select).toBeDisabled();
    expect(input).toHaveAttribute('readonly');
    for (const control of [select, input]) {
      expect(control).toHaveAttribute('aria-required', 'true');
      expect(control).not.toHaveAttribute('required');
    }
  });

  it('deixa o submit vazio chegar ao handler de validação da aplicação', async () => {
    const submit = vi.fn();
    const user = userEvent.setup();
    render(<form onSubmit={event => { event.preventDefault(); submit(); }}>
      <Field label="Nome *"><input /></Field>
      <Field label="Documento *"><input type="file" /></Field>
      <button type="submit">Conferir</button>
    </form>);

    await user.click(screen.getByRole('button', { name: 'Conferir' }));

    expect(submit).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: 'Nome *' })).toHaveValue('');
  });
});
