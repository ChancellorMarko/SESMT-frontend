import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinalPdfDto, WorkPermitDto } from '../../shared/contracts/work-permits';
import { api } from '../../shared/api/client';
import { PermitPrintPage } from './PermitPrintPage';
import { triggerDownload } from '../../shared/lib/downloads';

const state = vi.hoisted(() => ({
  permit: null as WorkPermitDto | null,
  unitId: 'unit',
}));
vi.mock('../../shared/lib/downloads', () => ({ triggerDownload: vi.fn() }));

vi.mock('../../shared/auth/SessionProvider', () => ({
  useSession: () => ({
    sessionKey: 'session',
    unitId: state.unitId,
    me: { user: { id: 'engineer', displayName: 'Marina Demo' } },
    can: () => true,
  }),
}));

vi.mock('../../shared/api/client', async original => {
  const actual = await original<typeof import('../../shared/api/client')>();
  return {
    ...actual,
    api: {
      get: vi.fn(async (path: string) => {
        if (path.endsWith('/attachments')) return [];
        if (path.endsWith('/final-pdf')) {
          return {
            url: 'blob:http://localhost/final.pdf',
            permitId: 'permit', version: 1, expiresAt: new Date(Date.now() + 60000).toISOString(),
            fileName: 'PT-TESTE-final-v1.pdf',
            mimeType: 'application/pdf',
            backendPersisted: false,
            disclaimer: 'Documento demonstrativo de PDF.',
          };
        }
        return structuredClone(state.permit);
      }),
    },
  };
});

function example(): WorkPermitDto {
  return {
    id: 'permit',
    code: 'PT-TESTE',
    version: 1,
    revision: 4,
    templateVersion: 'Modelo escolar v1',
    appointment: {
      id: 'appointment',
      code: 'AG-TESTE',
      unitId: 'unit',
      teamId: 'team',
      teamName: 'Equipe Demo',
      serviceTypeId: 'service',
      serviceLabel: 'Serviço ilustrativo',
      location: 'Local de demonstração',
      startsAt: '2026-10-09T12:00:00Z',
      endsAt: '2026-10-09T14:00:00Z',
      responsibleId: 'technician',
      responsibleName: 'Técnico Demo',
      participants: [{ workerId: 'worker', name: 'José Demo', serviceFunction: 'Operador Demo' }],
      status: 'ATTENDANCE_OPENED',
      revision: 1,
      availableActions: [],
      history: [],
    },
    operationStatus: 'VERIFICATION',
    reviewStatus: 'NOT_SUBMITTED',
    checklist: [{ id: 'check', label: 'Conferência ilustrativa', required: true, answer: 'YES' }],
    sciences: [],
    eligibility: {
      appointmentId: 'appointment',
      eligible: true,
      checkedAt: '2026-10-09T12:00:00Z',
      requirementVersion: 'Matriz escolar v1',
      participants: [{ workerId: 'worker', name: 'José Demo', serviceFunction: 'Operador Demo', eligible: true, items: [] }],
    },
    availableActions: ['RELEASE'],
    snapshots: [],
    history: [],
  };
}

function show(search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/pts/permit/imprimir' + search]}>
        <Routes>
          <Route path="/app/pts/:id/imprimir" element={<PermitPrintPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return client;
}
function pdfReceipt(change: Partial<FinalPdfDto> = {}): FinalPdfDto {
  return { permitId: 'permit', version: 1, url: 'blob:http://localhost/final.pdf', fileName: 'PT-TESTE-final-v1.pdf', expiresAt: new Date(Date.now() + 60000).toISOString(), mimeType: 'application/pdf', backendPersisted: false, disclaimer: 'Documento demonstrativo de PDF.', ...change };
}

beforeEach(() => {
  state.permit = example();
  state.unitId = 'unit';
  vi.clearAllMocks();
});

describe('visualização e impressão da permissão de trabalho', () => {
  it('renderiza o cabeçalho e dados da PT imprimível', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'PT-TESTE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Imprimir \/ salvar PDF/ })).toBeInTheDocument();
    expect(screen.getByText('Serviço ilustrativo')).toBeInTheDocument();
    expect(screen.getByText('Equipe Demo')).toBeInTheDocument();
  });

  it('exibe a imagem da assinatura do revisor gravada no snapshot (#112)', async () => {
    const signatureImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    state.permit = {
      ...example(),
      operationStatus: 'COMPLETED',
      reviewStatus: 'VALIDATED',
      snapshots: [
        {
          version: 1,
          submittedAt: '2026-10-09T14:00:00Z',
          reviewedAt: '2026-10-09T15:00:00Z',
          summary: 'Encerramento concluído com sucesso.',
          checklist: example().checklist,
          sciences: [],
          decision: 'APPROVE',
          signatureRepresentation: 'Marina Demo',
          signatureMethod: 'DRAWN',
          signatureImage,
        },
      ],
    };

    show();
    const img = await screen.findByAltText(/Representação visual de Marina Demo/);
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', signatureImage);
    expect(screen.getByText(/Desenho/)).toBeInTheDocument();
  });

  it('disponibiliza botão de download do PDF final controlado para PT concluída (#115)', async () => {
    state.permit = {
      ...example(),
      operationStatus: 'COMPLETED',
      reviewStatus: 'VALIDATED',
      snapshots: [{ version: 1, submittedAt: '2026-10-09T15:00:00Z', summary: 'Registro aprovado.', checklist: [], sciences: [], decision: 'APPROVE' }],
    };

    const user = userEvent.setup();
    show();

    const downloadBtn = await screen.findByRole('button', { name: /Baixar PDF final/ });
    expect(downloadBtn).toBeInTheDocument();

    await user.click(downloadBtn);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/work-permits/permit/final-pdf', { query: { version: 1 }, signal: expect.any(AbortSignal) }));
    expect(await screen.findByText('Documento demonstrativo de PDF.')).toBeInTheDocument();
  });

  it('não oferece PDF final para snapshot pendente ou devolvido, mesmo com operação concluída', async () => {
    state.permit = { ...example(), operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW', snapshots: [{ version: 1, submittedAt: '2026-10-09T15:00:00Z', summary: 'Registro pendente.', checklist: [], sciences: [] }] };
    const client = show(); await screen.findByRole('heading', { name: 'PT-TESTE' });
    expect(screen.queryByRole('button', { name: /Baixar PDF final/ })).not.toBeInTheDocument();
    await act(async () => { client.setQueryData(['work-permit', 'session', 'unit', 'permit'], { ...state.permit, reviewStatus: 'RETURNED', snapshots: [{ ...state.permit!.snapshots[0], decision: 'RETURN' }] }); });
    expect(screen.queryByRole('button', { name: /Baixar PDF final/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Imprimir \/ salvar PDF/ })).toBeInTheDocument();
  });
  it('recusa um link expirado da versão histórica e permite obter outro', async () => {
    state.permit = { ...example(), version: 2, operationStatus: 'COMPLETED', snapshots: [{ version: 1, submittedAt: '2026-10-09T15:00:00Z', summary: 'Registro histórico aprovado.', checklist: [], sciences: [], decision: 'APPROVE' }] };
    let attempts = 0;
    vi.mocked(api.get).mockImplementation(async path => path.endsWith('/final-pdf') ? pdfReceipt(attempts++ === 0 ? { expiresAt: '2000-01-01T00:00:00Z' } : {}) : path.endsWith('/attachments') ? [] : structuredClone(state.permit));
    const user = userEvent.setup(); show('?version=1');
    const button = await screen.findByRole('button', { name: /Baixar PDF final/ });
    expect(screen.getByText('O PDF desta versão aprovada é demonstrativo, sem persistência ou validade operacional.')).toBeInTheDocument();
    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(/vencido ou sem prazo válido/);
    expect(triggerDownload).not.toHaveBeenCalled();
    await user.click(button);
    await waitFor(() => expect(triggerDownload).toHaveBeenCalledOnce());
    expect(attempts).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('solicita a versão histórica aprovada selecionada e não a versão atual em correção', async () => {
    state.permit = { ...example(), version: 2, operationStatus: 'COMPLETED', snapshots: [{ version: 1, submittedAt: '2026-10-09T15:00:00Z', summary: 'Registro histórico aprovado.', checklist: [], sciences: [], decision: 'APPROVE' }] };
    const user = userEvent.setup(); show('?version=1');
    await user.click(await screen.findByRole('button', { name: /Baixar PDF final/ }));
    expect(api.get).toHaveBeenCalledWith('/work-permits/permit/final-pdf', { query: { version: 1 }, signal: expect.any(AbortSignal) });
    expect(triggerDownload).toHaveBeenCalledOnce();
    await user.selectOptions(screen.getByLabelText('Versão do registro'), '2');
    expect(screen.queryByRole('button', { name: /Baixar PDF final/ })).not.toBeInTheDocument();
  });

  it('não baixa um arquivo retornado para outra versão', async () => {
    state.permit = { ...example(), operationStatus: 'COMPLETED', reviewStatus: 'VALIDATED', snapshots: [{ version: 1, submittedAt: '2026-10-09T15:00:00Z', summary: 'Registro aprovado.', checklist: [], sciences: [], decision: 'APPROVE' }] };
    vi.mocked(api.get).mockImplementation(async (path) => path.endsWith('/final-pdf') ? { url: 'blob:http://localhost/wrong.pdf', fileName: 'v2.pdf', version: 2 } : path.endsWith('/attachments') ? [] : structuredClone(state.permit));
    const user = userEvent.setup(); show(); await user.click(await screen.findByRole('button', { name: /Baixar PDF final/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/não corresponde à versão solicitada/);
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it('aborta e ignora o download pendente se a seleção de versão muda', async () => {
    state.permit = { ...example(), version: 2, operationStatus: 'COMPLETED', snapshots: [{ version: 1, submittedAt: '2026-10-09T15:00:00Z', summary: 'Registro aprovado.', checklist: [], sciences: [], decision: 'APPROVE' }] };
    let resolvePdf!: (value: unknown) => void; let signal!: AbortSignal;
    vi.mocked(api.get).mockImplementation(async (path, options) => {
      if (path.endsWith('/final-pdf')) { signal = options!.signal!; return new Promise(resolve => { resolvePdf = resolve; }); }
      return path.endsWith('/attachments') ? [] : structuredClone(state.permit);
    });
    const user = userEvent.setup(); show('?version=1'); await user.click(await screen.findByRole('button', { name: /Baixar PDF final/ }));
    await user.selectOptions(screen.getByLabelText('Versão do registro'), '2');
    expect(signal.aborted).toBe(true);
    await act(async () => { resolvePdf({ url: 'blob:http://localhost/v1.pdf', fileName: 'v1.pdf', disclaimer: 'Resposta antiga.' }); });
    expect(triggerDownload).not.toHaveBeenCalled(); expect(screen.queryByText('Resposta antiga.')).not.toBeInTheDocument();
  });

  it('exibe estado vazio quando a unidade do atendimento difere da unidade ativa', async () => {
    state.unitId = 'other-unit';
    show();

    expect(await screen.findByRole('heading', { name: 'PT de outra unidade' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'PT-TESTE' })).not.toBeInTheDocument();
  });
});
