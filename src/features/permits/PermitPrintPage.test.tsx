import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import { api } from '../../shared/api/client';
import { PermitPrintPage } from './PermitPrintPage';

const state = vi.hoisted(() => ({
  permit: null as WorkPermitDto | null,
  unitId: 'unit',
}));

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

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/pts/permit/imprimir']}>
        <Routes>
          <Route path="/app/pts/:id/imprimir" element={<PermitPrintPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return client;
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
    };

    const user = userEvent.setup();
    show();

    const downloadBtn = await screen.findByRole('button', { name: /Baixar PDF final/ });
    expect(downloadBtn).toBeInTheDocument();

    await user.click(downloadBtn);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/work-permits/permit/final-pdf'));
    expect(await screen.findByText('Documento demonstrativo de PDF.')).toBeInTheDocument();
  });

  it('exibe estado vazio quando a unidade do atendimento difere da unidade ativa', async () => {
    state.unitId = 'other-unit';
    show();

    expect(await screen.findByRole('heading', { name: 'PT de outra unidade' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'PT-TESTE' })).not.toBeInTheDocument();
  });
});
