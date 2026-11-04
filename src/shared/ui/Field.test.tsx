import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from './index';

describe('rótulo dos campos', () => {
  it('mantém o nome do seletor separado das opções e descreve o erro', () => {
    render(<Field label="Situação" error="Selecione uma situação."><select defaultValue=""><option value="">Todas</option><option value="CONFIRMED">Confirmado</option></select></Field>);
    const select = screen.getByRole('combobox', { name: 'Situação' });
    expect(screen.getByLabelText('Situação', { exact: true })).toBe(select);
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Selecione uma situação.');
  });
  it('preserva o id e a descrição de ajuda fornecidos pelo campo', () => {
    render(<><p id="ajuda">Use seu código interno.</p><Field label="Matrícula" error="Campo obrigatório."><input id="matricula" aria-describedby="ajuda" /></Field></>);
    const input=screen.getByRole('textbox',{name:'Matrícula'});
    expect(input).toHaveAttribute('id','matricula');
    expect(input).toHaveAccessibleDescription('Use seu código interno. Campo obrigatório.');
  });
  it('associa erro e rótulo ao input com botão de mostrar senha no contêiner', () => {
    render(<Field label="Senha" error="Informe sua senha."><span><input type="password"/><button type="button">Mostrar senha</button></span></Field>);
    expect(screen.getByLabelText('Senha',{exact:true})).toHaveAttribute('aria-invalid','true');
    expect(screen.getByLabelText('Senha',{exact:true})).toHaveAccessibleDescription('Informe sua senha.');
    expect(screen.getByRole('button',{name:'Mostrar senha'})).not.toHaveAttribute('aria-invalid');
  });
});
