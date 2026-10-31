import { describe, expect, it } from 'vitest';
import { pageTitle } from './page-title';

const title = (label: string) => `${label} — Ampara SESMT`;

describe('título da página', () => {
  it('identifica o início e as etapas públicas sem incluir o convite recebido', () => {
    expect(pageTitle('/')).toBe(title('Início'));
    expect(pageTitle('/app')).toBe(title('Início'));
    expect(pageTitle('/login')).toBe(title('Entrar'));
    expect(pageTitle('/mfa')).toBe(title('Verificar acesso'));
    expect(pageTitle('/recuperar-acesso')).toBe(title('Recuperar acesso'));
    expect(pageTitle('/redefinir-senha')).toBe(title('Definir nova senha'));
    expect(pageTitle('/reset-password')).toBe(title('Definir nova senha'));
    expect(pageTitle('/convite/token-secreto-de-equipe')).toBe(title('Convite de equipe'));
  });

  it('distingue criação, edição, nova versão e movimentação dos respectivos detalhes', () => {
    const cases = [
      ['/app/agenda/novo', 'Agendar serviço'],
      ['/app/agenda/AG-001', 'Atendimento'],
      ['/app/equipes/novo', 'Nova equipe'],
      ['/app/equipes/EQ-001/editar', 'Editar equipe'],
      ['/app/designacoes/nova', 'Nova designação'],
      ['/app/designacoes/DS-001', 'Designação operacional'],
      ['/app/ats/nova', 'Criar autorização de trabalho'],
      ['/app/ats/AT-001/editar', 'Editar autorização de trabalho'],
      ['/app/ats/AT-001', 'Autorização de trabalho'],
      ['/app/pets/nova', 'Preparar permissão de entrada e trabalho'],
      ['/app/pets/PET-001/editar', 'Editar permissão de entrada e trabalho'],
      ['/app/pets/PET-001', 'Permissão de entrada e trabalho'],
      ['/app/documentos/novo', 'Novo documento'],
      ['/app/documentos/DOC-001/editar', 'Editar documento'],
      ['/app/documentos/DOC-001/versoes/nova', 'Anexar nova versão'],
      ['/app/documentos/DOC-001', 'Documento'],
      ['/app/trabalhadores/novo', 'Novo trabalhador'],
      ['/app/trabalhadores/TR-001/editar', 'Editar trabalhador'],
      ['/app/trabalhadores/TR-001/movimentacoes/nova', 'Registrar movimentação'],
      ['/app/trabalhadores/TR-001', 'Ficha do trabalhador'],
    ];
    for (const [pathname, label] of cases) expect(pageTitle(pathname)).toBe(title(label));
  });

  it('fornece título genérico de impressão antes de carregar um registro específico', () => {
    for (const [resource, label] of [['pts', 'permissão de trabalho'], ['ats', 'autorização de trabalho'], ['pets', 'permissão de entrada e trabalho']]) {
      expect(pageTitle(`/app/${resource}/registro-confidencial/imprimir`)).toBe(title(`Imprimir ${label}`));
    }
  });

  it('mantém identificadores e dados codificados fora dos títulos', () => {
    for (const id of ['pessoa@example.com', '123.456.789-00', 'Maria%20da%20Silva', 'privado%2Fprontuario']) {
      expect(pageTitle(`/app/trabalhadores/${id}`)).toBe(title('Ficha do trabalhador'));
      expect(pageTitle(`/convite/${id}`)).toBe(title('Convite de equipe'));
    }
    // React Router also recognizes percent-encoded static route segments.
    expect(pageTitle('/app/%64ocumentos/novo')).toBe(title('Novo documento'));
  });

  it('exige a rota completa e mantém endereços desconhecidos fora do título', () => {
    for (const pathname of ['/desconhecido', '/app/agenda/AG-001/extra', '/app/configuracoes/desconhecido', '/app/%70rivado%20Maria', '/convite/token/extra']) {
      expect(pageTitle(pathname)).toBe(title('Página não encontrada'));
    }
  });

  it('identifica áreas de consulta, organização e configuração sem dados da unidade', () => {
    const paths = [
      '/app/dashboard', '/app/painel-documental', '/app/consulta', '/app/minha-representacao',
      '/app/agenda', '/app/equipes', '/app/pts', '/app/ats', '/app/pets', '/app/designacoes',
      '/app/modelos-pt', '/app/pendencias', '/app/documentos', '/app/vencimentos', '/app/trabalhadores',
      '/app/organizacao', '/app/notificacoes', '/app/auditoria', '/app/configuracoes/usuarios',
      '/app/configuracoes/tipos-documentais', '/app/configuracoes/parametros',
      '/app/configuracoes/requisitos', '/app/configuracoes/servicos',
    ];
    for (const pathname of paths) {
      expect(pageTitle(pathname)).not.toBe(title('Página não encontrada'));
      expect(pageTitle(pathname)).toMatch(/ — Ampara SESMT$/);
    }
    expect(pageTitle('/app/agenda/')).toBe(title('Agenda de serviços'));
  });
});
