import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router';
import { useSession } from '../shared/auth/SessionProvider';
import { LoginPage, RecoveryPage, ResetPasswordPage } from '../features/auth/AuthPages';
import { AppLayout } from './layouts/AppLayout';
import { Spinner } from '../shared/ui';
import { AppErrorBoundary } from './AppErrorBoundary';

const DocumentsPage=lazy(()=>import('../features/documents').then(m=>({default:m.DocumentsPage})));
const ExpirationsPage=lazy(()=>import('../features/documents/ExpirationsPage').then(m=>({default:m.ExpirationsPage})));
const DocumentFormPage=lazy(()=>import('../features/documents').then(m=>({default:m.DocumentFormPage})));
const DocumentDetailPage=lazy(()=>import('../features/documents').then(m=>({default:m.DocumentDetailPage})));
const VersionFormPage=lazy(()=>import('../features/documents').then(m=>({default:m.VersionFormPage})));
const WorkersPage=lazy(()=>import('../features/workers').then(m=>({default:m.WorkersPage})));
const WorkerFormPage=lazy(()=>import('../features/workers').then(m=>({default:m.WorkerFormPage})));
const WorkerDetailPage=lazy(()=>import('../features/workers').then(m=>({default:m.WorkerDetailPage})));
const WorkerMovementPage=lazy(()=>import('../features/workers').then(m=>({default:m.WorkerMovementPage})));
const OrganizationPage=lazy(()=>import('../features/organization').then(m=>({default:m.OrganizationPage})));
const DashboardPage=lazy(()=>import('../features/dashboard').then(m=>({default:m.DashboardPage})));
const NotificationsPage=lazy(()=>import('../features/notifications').then(m=>({default:m.NotificationsPage})));
const AuditPage=lazy(()=>import('../features/audit').then(m=>({default:m.AuditPage})));
const UsersPage=lazy(()=>import('../features/administration').then(m=>({default:m.UsersPage})));
const DocumentTypesPage=lazy(()=>import('../features/administration').then(m=>({default:m.DocumentTypesPage})));
const ParametersPage=lazy(()=>import('../features/administration').then(m=>({default:m.ParametersPage})));
const OperationsDashboardPage=lazy(()=>import('../features/dashboard/OperationsDashboardPage').then(m=>({default:m.OperationsDashboardPage})));
const AgendaPage=lazy(()=>import('../features/agenda').then(m=>({default:m.AgendaPage})));
const AppointmentFormPage=lazy(()=>import('../features/agenda').then(m=>({default:m.AppointmentFormPage})));
const AppointmentDetailPage=lazy(()=>import('../features/agenda').then(m=>({default:m.AppointmentDetailPage})));
const TeamsPage=lazy(()=>import('../features/teams').then(m=>({default:m.TeamsPage})));
const TeamFormPage=lazy(()=>import('../features/teams/TeamFormPage').then(m=>({default:m.TeamFormPage})));
const PermitsPage=lazy(()=>import('../features/permits').then(m=>({default:m.PermitsPage})));
const PermitDetailPage=lazy(()=>import('../features/permits').then(m=>({default:m.PermitDetailPage})));
const PermitPrintPage=lazy(()=>import('../features/permits/PermitPrintPage').then(m=>({default:m.PermitPrintPage})));
const PermitTemplatesPage=lazy(()=>import('../features/permits/PermitTemplatesPage').then(m=>({default:m.PermitTemplatesPage})));
const RequirementMatrixPage=lazy(()=>import('../features/requirements/RequirementMatrixPage').then(m=>({default:m.RequirementMatrixPage})));
const ServiceTemplatesPage=lazy(()=>import('../features/service-templates/ServiceTemplatesPage').then(m=>({default:m.ServiceTemplatesPage})));
const DocumentaryReadinessPage=lazy(()=>import('../features/requirements/DocumentaryReadinessPage').then(m=>({default:m.DocumentaryReadinessPage})));
const WorkAuthorizationsPage=lazy(()=>import('../features/authorizations/WorkAuthorizationsPage').then(m=>({default:m.WorkAuthorizationsPage})));
const AuthorizationFormPage=lazy(()=>import('../features/authorizations/AuthorizationFormPage').then(m=>({default:m.AuthorizationFormPage})));
const AuthorizationDetailPage=lazy(()=>import('../features/authorizations/AuthorizationDetailPage').then(m=>({default:m.AuthorizationDetailPage})));
const AuthorizationPrintPage=lazy(()=>import('../features/authorizations/AuthorizationPrintPage').then(m=>({default:m.AuthorizationPrintPage})));
const PetsPage=lazy(()=>import('../features/confined-space/PetsPage').then(m=>({default:m.PetsPage})));
const PetFormPage=lazy(()=>import('../features/confined-space/PetFormPage').then(m=>({default:m.PetFormPage})));
const PetDetailPage=lazy(()=>import('../features/confined-space/PetDetailPage').then(m=>({default:m.PetDetailPage})));
const PetPrintPage=lazy(()=>import('../features/confined-space/PetPrintPage').then(m=>({default:m.PetPrintPage})));
const DesignationsPage=lazy(()=>import('../features/designations').then(m=>({default:m.DesignationsPage})));
const DesignationFormPage=lazy(()=>import('../features/designations').then(m=>({default:m.DesignationFormPage})));
const DesignationDetailPage=lazy(()=>import('../features/designations').then(m=>({default:m.DesignationDetailPage})));
const ConsultationPage=lazy(()=>import('../features/search/ConsultationPage').then(m=>({default:m.ConsultationPage})));
const TeamInvitePage=lazy(()=>import('../features/teams/TeamInvitePage').then(m=>({default:m.TeamInvitePage})));
export function Guard({ permission,children }: { permission?: string; children:ReactNode }) {
  const s=useSession(); if(s.status==='restoring') return <Spinner/>;
  if(!s.me) return <Navigate to="/login" replace/>;
  if(permission&&!s.can(permission)) return <div className="error-page"><p className="eyebrow">ACESSO RESTRITO</p><h1>Esta área precisa de autorização.</h1><p>Seu perfil não possui acesso a esta funcionalidade. Solicite a concessão ao responsável.</p><Link to="/app" className="button button--primary">Voltar ao início</Link></div>;
  return children;
}
function Home() { const s=useSession(); return <Navigate replace to={s.can('dashboard.read')?'/app/dashboard':s.can('documents.read')?'/app/documentos':'/app/notificacoes'}/>; }
export function App() {
  const location = useLocation(); const session = useSession();
  return <AppErrorBoundary resetKey={`${location.key}:${session.sessionKey}:${session.unitId}`}><Suspense fallback={<Spinner/>}><Routes>
    <Route path="/login" element={<LoginPage/>}/><Route path="/mfa" element={<Navigate to="/login" replace/>}/>
    <Route path="/recuperar-acesso" element={<RecoveryPage/>}/><Route path="/redefinir-senha" element={<ResetPasswordPage/>}/>
    <Route path="/convite/:token" element={<TeamInvitePage/>}/>
    <Route path="/app" element={<Guard><AppLayout/></Guard>}>
      <Route index element={<Home/>}/>
      <Route path="consulta" element={<Guard><ConsultationPage/></Guard>}/>
      <Route path="dashboard" element={<Guard permission="dashboard.read"><OperationsDashboardPage/></Guard>}/>
      <Route path="painel-documental" element={<Guard permission="dashboard.read"><DashboardPage/></Guard>}/>
      <Route path="agenda" element={<Guard permission="appointments.read"><AgendaPage/></Guard>}/>
      <Route path="agenda/novo" element={<Guard permission="appointments.write"><AppointmentFormPage/></Guard>}/>
      <Route path="agenda/:id" element={<Guard permission="appointments.read"><AppointmentDetailPage/></Guard>}/>
      <Route path="equipes" element={<Guard permission="teams.read"><TeamsPage/></Guard>}/>
      <Route path="equipes/novo" element={<Guard permission="teams.write"><TeamFormPage/></Guard>}/>
      <Route path="equipes/:id/editar" element={<Guard permission="teams.write"><TeamFormPage/></Guard>}/>
      <Route path="pts" element={<Guard permission="permits.read"><PermitsPage/></Guard>}/>
      <Route path="pts/:id" element={<Guard permission="permits.read"><PermitDetailPage/></Guard>}/>
      <Route path="pts/:id/imprimir" element={<Guard permission="permits.read"><PermitPrintPage/></Guard>}/>
      <Route path="designacoes" element={<Guard permission="appointments.read"><DesignationsPage/></Guard>}/>
      <Route path="designacoes/nova" element={<Guard permission="appointments.write"><DesignationFormPage/></Guard>}/>
      <Route path="designacoes/:id" element={<Guard permission="appointments.read"><DesignationDetailPage/></Guard>}/>
      <Route path="modelos-pt" element={<Guard permission="permits.read"><PermitTemplatesPage/></Guard>}/>
      <Route path="pendencias" element={<Guard permission="eligibility.read"><DocumentaryReadinessPage/></Guard>}/>
      <Route path="ats" element={<Guard permission="at.read"><WorkAuthorizationsPage/></Guard>}/>
      <Route path="ats/nova" element={<Guard permission="at.write"><AuthorizationFormPage/></Guard>}/>
      <Route path="ats/:id" element={<Guard permission="at.read"><AuthorizationDetailPage/></Guard>}/>
      <Route path="ats/:id/editar" element={<Guard permission="at.write"><AuthorizationFormPage/></Guard>}/>
      <Route path="ats/:id/imprimir" element={<Guard permission="at.read"><AuthorizationPrintPage/></Guard>}/>
      <Route path="pets" element={<Guard permission="pet.read"><PetsPage/></Guard>}/>
      <Route path="pets/nova" element={<Guard permission="pet.write"><PetFormPage/></Guard>}/>
      <Route path="pets/:id" element={<Guard permission="pet.read"><PetDetailPage/></Guard>}/>
      <Route path="pets/:id/editar" element={<Guard permission="pet.write"><PetFormPage/></Guard>}/>
      <Route path="pets/:id/imprimir" element={<Guard permission="pet.read"><PetPrintPage/></Guard>}/>
      <Route path="documentos" element={<Guard permission="documents.read"><DocumentsPage/></Guard>}/>
      <Route path="vencimentos" element={<Guard permission="documents.read"><ExpirationsPage/></Guard>}/>
      <Route path="documentos/novo" element={<Guard permission="documents.write"><DocumentFormPage/></Guard>}/>
      <Route path="documentos/:id" element={<Guard permission="documents.read"><DocumentDetailPage/></Guard>}/>
      <Route path="documentos/:id/editar" element={<Guard permission="documents.write"><DocumentFormPage/></Guard>}/>
      <Route path="documentos/:id/versoes/nova" element={<Guard permission="documents.write"><VersionFormPage/></Guard>}/>
      <Route path="trabalhadores" element={<Guard permission="workers.read"><WorkersPage/></Guard>}/>
      <Route path="trabalhadores/novo" element={<Guard permission="workers.write"><WorkerFormPage/></Guard>}/>
      <Route path="trabalhadores/:id" element={<Guard permission="workers.read"><WorkerDetailPage/></Guard>}/>
      <Route path="trabalhadores/:id/editar" element={<Guard permission="workers.write"><WorkerFormPage/></Guard>}/>
      <Route path="trabalhadores/:id/movimentacoes/nova" element={<Guard permission="workers.write"><WorkerMovementPage/></Guard>}/>
      <Route path="organizacao" element={<Guard permission="organization.read"><OrganizationPage/></Guard>}/>
      <Route path="notificacoes" element={<Guard permission="notifications.read"><NotificationsPage/></Guard>}/>
      <Route path="auditoria" element={<Guard permission="audit.read"><AuditPage/></Guard>}/>
      <Route path="configuracoes/usuarios" element={<Guard permission="users.manage"><UsersPage/></Guard>}/>
      <Route path="configuracoes/tipos-documentais" element={<Guard permission="documentTypes.write"><DocumentTypesPage/></Guard>}/>
      <Route path="configuracoes/parametros" element={<Guard permission="documentTypes.write"><ParametersPage/></Guard>}/>
      <Route path="configuracoes/requisitos" element={<Guard permission="requirements.read"><RequirementMatrixPage/></Guard>}/>
      <Route path="configuracoes/servicos" element={<Guard permission="requirements.read"><ServiceTemplatesPage/></Guard>}/>
    </Route>
    <Route path="/" element={<Navigate to="/app" replace/>}/>
    <Route path="*" element={<div className="error-page"><h1>Página não encontrada.</h1><p>O endereço pode ter sido alterado.</p><Link to="/app" className="button button--primary">Voltar ao início</Link></div>}/>
  </Routes></Suspense></AppErrorBoundary>;
}
