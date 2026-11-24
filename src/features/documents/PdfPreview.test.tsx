import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfPreview, PREVIEW_PAGE_LIMIT } from './PdfPreview';

const pdf = vi.hoisted(() => ({ pages: 1, fail: false, destroyed: 0, rendered: [] as number[], request: undefined as unknown }));
vi.mock('./pdf-runtime', () => ({ loadPdfjs: () => ({ getDocument: (request: unknown) => {
  pdf.request = request;
  return {
    destroy: async () => { pdf.destroyed++; },
    promise: pdf.fail ? Promise.reject(new Error('Invalid PDF structure')) : Promise.resolve({
      numPages: pdf.pages,
      getPage: async (number: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
        render: () => { pdf.rendered.push(number); return { promise: Promise.resolve() }; },
        cleanup: () => {},
      }),
    }),
  };
} }) }));

beforeEach(() => { Object.assign(pdf, { pages: 1, fail: false, destroyed: 0, rendered: [], request: undefined }); });

describe('prévia de PDF desenhada na própria tela', () => {
  it('desenha as páginas sem entregar o arquivo ao visualizador do navegador', async () => {
    pdf.pages = 2;
    const { container } = render(<PdfPreview url="blob:http://localhost/arquivo" fileName="PGR.pdf"/>);
    expect(await screen.findByText('2 páginas.')).toBeVisible();
    await waitFor(() => expect(pdf.rendered).toEqual([1, 2]));
    expect(screen.getByRole('region', { name: 'Prévia de PGR.pdf' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Página 2 de 2' })).toBeInTheDocument();
    expect(container.querySelector('iframe, object, embed')).toBeNull();
    expect(pdf.request).toMatchObject({ url: 'blob:http://localhost/arquivo', enableXfa: false });
  });

  it(`limita a prévia às ${PREVIEW_PAGE_LIMIT} primeiras páginas e avisa`, async () => {
    pdf.pages = 40;
    render(<PdfPreview url="/arquivo.pdf" fileName="longo.pdf"/>);
    expect(await screen.findByText(`Mostrando as ${PREVIEW_PAGE_LIMIT} primeiras de 40 páginas. Abra o arquivo para ver todas.`)).toBeVisible();
    await waitFor(() => expect(pdf.rendered).toHaveLength(PREVIEW_PAGE_LIMIT));
  });

  it('orienta a abrir o arquivo quando o PDF não pode ser desenhado', async () => {
    pdf.fail = true;
    render(<PdfPreview url="/quebrado.pdf" fileName="quebrado.pdf"/>);
    expect(await screen.findByText(/Não foi possível montar a prévia deste PDF/)).toBeVisible();
  });

  it('cancela o carregamento ao fechar a prévia', async () => {
    const view = render(<PdfPreview url="/arquivo.pdf" fileName="PGR.pdf"/>);
    await screen.findByText('1 página.');
    view.unmount();
    expect(pdf.destroyed).toBe(1);
  });
});
