import { createContext, Suspense, useContext, useEffect, useRef, type ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, Route, RouterProvider, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutePresentation } from './RoutePresentation';

type Configuration = {
  contextKey: string;
  ready: boolean;
  hiddenPrevious: boolean;
  modal: boolean;
};
const initialConfiguration: Configuration = { contextKey: 'session:unit-a', ready: true, hiddenPrevious: false, modal: false };
const ConfigurationContext = createContext(initialConfiguration);

function Destination({ title, delayed = false, children }: { title: string; delayed?: boolean; children?: ReactNode }) {
  const { ready, hiddenPrevious } = useContext(ConfigurationContext);
  if (delayed && !ready) return <>
    {hiddenPrevious && <div style={{ display: 'none' }}><h1 tabIndex={-1}>Título da página anterior</h1></div>}
    <p role="status">Carregando informações…</p>
  </>;
  return <><h1>{title}</h1><label>Campo do destino<input /></label>{children}</>;
}

function HashDestination() {
  const section = useRef<HTMLElement>(null);
  useEffect(() => { section.current?.focus(); }, []);
  return <Destination title="Cadastro do trabalhador"><section id="integracao" ref={section} tabIndex={-1}>Integração do trabalhador</section></Destination>;
}

function PrintDestination() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'PT-DEMO-01 — versão 2 — Ampara SESMT';
    return () => { document.title = previous; };
  }, []);
  return <Destination title="Visualização e impressão da PT"><article><h1>PT-DEMO-01</h1></article></Destination>;
}

function NavigationModal() {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { dialog.current?.focus(); }, []);
  return <div ref={dialog} role="dialog" aria-modal="true" aria-label="Navegação" tabIndex={-1}>Menu de navegação</div>;
}

function DashboardDestination() {
  const area = new URLSearchParams(useLocation().search).get('area');
  return <Destination key={area} title={area === 'inspecoes' ? 'Inspeções de segurança' : area === 'saude' ? 'ASOs e NRs' : 'Visão geral'} />;
}

function Harness() {
  const configuration = useContext(ConfigurationContext);
  return <>
    <label>Unidade de trabalho<select defaultValue="a"><option value="a">Unidade A</option><option value="b">Unidade B</option></select></label>
    <Suspense fallback={<p role="status">Carregando módulo…</p>}>
      <RoutePresentation contextKey={configuration.contextKey} />
      <main id="conteudo" tabIndex={-1}>
        <Routes>
          <Route path="/app/dashboard" element={<DashboardDestination />} />
          <Route path="/app/documentos" element={<Destination title="Documentos" delayed />} />
          <Route path="/app/agenda" element={<Destination title="Agenda de serviços" />} />
          <Route path="/app/trabalhadores/w1" element={<HashDestination />} />
          <Route path="/app/pts/p1/imprimir" element={<PrintDestination />} />
          <Route path="/app/erro" element={<div role="alert">Não foi possível carregar o registro.</div>} />
        </Routes>
      </main>
    </Suspense>
    {configuration.modal && <NavigationModal />}
  </>;
}

function show(path = '/app/documentos', overrides: Partial<Configuration> = {}) {
  let configuration = { ...initialConfiguration, ...overrides };
  const router = createMemoryRouter([{ path: '*', element: <Harness /> }], { initialEntries: [path] });
  const tree = () => <ConfigurationContext.Provider value={configuration}><RouterProvider router={router} /></ConfigurationContext.Provider>;
  const view = render(tree());
  return {
    router,
    update(changes: Partial<Configuration>) {
      configuration = { ...configuration, ...changes };
      view.rerender(tree());
    },
  };
}

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
beforeEach(() => {
  document.title = 'Ampara SESMT';
  frames = new Map(); nextFrame = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
});
afterEach(() => { vi.restoreAllMocks(); });

async function flushFrames() {
  await act(async () => {
    await Promise.resolve();
    const pending = [...frames.entries()];
    frames.clear();
    pending.forEach(([, callback]) => callback(performance.now()));
    await Promise.resolve();
  });
}
async function navigate(router: ReturnType<typeof createMemoryRouter>, path: string) {
  await act(async () => { await router.navigate(path); });
  await flushFrames();
}

describe('apresentação acessível das rotas', () => {
  it('anuncia a troca de área do dashboard sem interromper suas abas internas', async () => {
    const { router } = show('/app/dashboard?area=inspecoes');
    await flushFrames();
    expect(document.title).toBe('Inspeções de segurança — Ampara SESMT');
    screen.getByRole('combobox', { name: 'Unidade de trabalho' }).focus();
    await navigate(router, '/app/dashboard?area=saude');
    expect(screen.getByRole('heading', { name: 'ASOs e NRs' })).toHaveFocus();
    expect(document.title).toBe('Saúde ocupacional e capacitações — Ampara SESMT');
    const input = screen.getByRole('textbox'); input.focus();
    await navigate(router, '/app/dashboard?area=saude&healthView=nrs');
    expect(input).toHaveFocus();
    expect(document.title).toBe('Saúde ocupacional e capacitações — Ampara SESMT');
  });
  it('identifica a página na aba e foca o título ao concluir a navegação', async () => {
    show();
    await flushFrames();
    expect(document.title).toContain('Documentos');
    expect(document.title).toContain('Ampara SESMT');
    expect(screen.getByRole('heading', { level: 1, name: 'Documentos' })).toHaveFocus();
  });

  it('aguarda o título carregado sem anunciar o estado de carregamento como destino', async () => {
    const view = show('/app/documentos', { ready: false });
    await flushFrames();
    expect(screen.getByRole('main')).not.toHaveFocus();
    view.update({ ready: true });
    await flushFrames();
    expect(screen.getByRole('heading', { name: 'Documentos' })).toHaveFocus();
  });

  it('ignora título anterior oculto enquanto o conteúdo novo está pendente', async () => {
    const view = show('/app/documentos', { ready: false, hiddenPrevious: true });
    await flushFrames();
    expect(screen.getByText('Título da página anterior')).not.toHaveFocus();
    view.update({ ready: true });
    await flushFrames();
    expect(screen.getByRole('heading', { name: 'Documentos' })).toHaveFocus();
  });

  it('mantém foco e edição de filtros ao alterar somente query', async () => {
    const { router } = show();
    await flushFrames();
    const input = screen.getByRole('textbox', { name: 'Campo do destino' });
    input.focus(); fireEvent.change(input, { target: { value: 'Texto em preenchimento' } });
    const title = document.title;
    await navigate(router, '/app/documentos?q=busca&page=2');
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Texto em preenchimento');
    expect(document.title).toBe(title);
  });

  it('não refoca o título ao alterar somente hash', async () => {
    const { router } = show();
    await flushFrames();
    const input = screen.getByRole('textbox'); input.focus();
    await navigate(router, '/app/documentos#historico');
    expect(input).toHaveFocus();
  });

  it('preserva o foco contextual de uma seção com hash na entrada da rota', async () => {
    show('/app/trabalhadores/w1#integracao');
    await flushFrames();
    expect(screen.getByText('Integração do trabalhador')).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Cadastro do trabalhador' })).not.toHaveFocus();
  });

  it('cancela o destino pendente quando outra rota é escolhida antes dos dados', async () => {
    const { router } = show('/app/documentos', { ready: false });
    await flushFrames();
    await navigate(router, '/app/agenda');
    expect(screen.getByRole('heading', { name: 'Agenda de serviços' })).toHaveFocus();
    await flushFrames();
    expect(screen.getByRole('heading', { name: 'Agenda de serviços' })).toHaveFocus();
    expect(document.title).toContain('Agenda');
  });

  it('não interrompe o usuário que interagiu por ponteiro antes de chegar o conteúdo', async () => {
    const view = show('/app/documentos', { ready: false });
    await flushFrames();
    fireEvent.pointerDown(screen.getByRole('main'));
    view.update({ ready: true });
    await flushFrames();
    expect(screen.getByRole('heading', { name: 'Documentos' })).not.toHaveFocus();
  });

  it('não interrompe a navegação por teclado iniciada durante o carregamento', async () => {
    const view = show('/app/documentos', { ready: false });
    await flushFrames();
    fireEvent.keyDown(document, { key: 'Tab' });
    view.update({ ready: true });
    await flushFrames();
    expect(screen.getByRole('heading', { name: 'Documentos' })).not.toHaveFocus();
  });

  it('cede ao foco explícito de um campo local antes do frame agendado', async () => {
    show();
    const input = screen.getByRole('textbox'); input.focus();
    await flushFrames();
    expect(input).toHaveFocus();
  });

  it('preserva o seletor de unidade ao trocar contexto na mesma rota', async () => {
    const view = show();
    await flushFrames();
    const selector = screen.getByRole('combobox', { name: 'Unidade de trabalho' }); selector.focus();
    view.update({ contextKey: 'session:unit-b' });
    await flushFrames();
    expect(selector).toHaveFocus();
  });

  it('aguarda o fechamento do menu modal antes de focar a nova página', async () => {
    const view = show('/app/documentos', { modal: true });
    await flushFrames();
    expect(screen.getByRole('dialog', { name: 'Navegação' })).toHaveFocus();
    view.update({ modal: false });
    await flushFrames();
    expect(screen.getByRole('heading', { name: 'Documentos' })).toHaveFocus();
  });

  it('usa a região principal quando a página termina em erro sem título', async () => {
    show('/app/erro');
    await flushFrames();
    expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.getByRole('alert')).toBeVisible();
  });

  it('preserva o título específico da impressão e restaura o destino após sair dela', async () => {
    const { router } = show('/app/pts/p1/imprimir');
    await flushFrames();
    expect(document.title).toBe('PT-DEMO-01 — versão 2 — Ampara SESMT');
    const input = screen.getByRole('textbox'); input.focus();
    await navigate(router, '/app/pts/p1/imprimir?version=2');
    expect(document.title).toBe('PT-DEMO-01 — versão 2 — Ampara SESMT');
    expect(input).toHaveFocus();
    await navigate(router, '/app/documentos');
    expect(document.title).toContain('Documentos');
    expect(document.title).not.toContain('PT-DEMO-01');
    expect(screen.getByRole('heading', { name: 'Documentos' })).toHaveFocus();
  });
});
