import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router';
import { useSession } from '../shared/auth/SessionProvider';
import { LoginPage, RecoveryPage, ResetPasswordPage } from '../features/auth/AuthPages';
import { AppLayout } from './layouts/AppLayout';
import { Spinner } from '../shared/ui';
import { AppErrorBoundary } from './AppErrorBoundary';
import { homePath } from './navigation';
import { RoutePresentation } from './navigation/RoutePresentation';
import { API_MODE } from '../shared/api/client';
import { NATIVE_MODULES } from '../shared/api/native-mode';

const DocumentsPage=lazy(()=>import('../features/documents').then(m=>({default:m.DocumentsPage})));
const ExpirationsPage=lazy(()=>import('../features/documents/ExpirationsPage').then(m=>({default:m.ExpirationsPage})));
const DocumentFormPage=lazy(()=>import('../features/documents').then(m=>({default:m.DocumentFormPage})));
const DocumentDetailPage=lazy(()=>import('../features/documents').then(m=>({default:m.DocumentDetailPage})));
const VersionFormPage=lazy(()=>import('../features/documents').then(m=>({default:m.VersionFormPage})));
const NativeDocumentCreate=lazy(()=>import('../features/native-documents/NativeDocumentCreate').then(m=>({default:m.NativeDocumentCreate})));
const NativeDocumentDetail=lazy(()=>import('../features/native-documents/NativeDocumentDetail').then(m=>({default:m.NativeDocumentDetail})));
const WorkersPage=lazy(()=>import('../features/workers').then(m=>({default:m.WorkersPage})));
const WorkerFormPage=lazy(()=>import('../features/workers').then(m=>({default:m.WorkerFormPage})));
const NativeWorkerCreate=lazy(()=>import('../features/native-workers/NativeWorkerCreate').then(m=>({default:m.NativeWorkerCreate})));
const NativeWorkerAccountPage=lazy(()=>import('../features/native-workers/NativeWorkerAccountPage').then(m=>({default:m.NativeWorkerAccountPage})));
const NativeWorkerProfessionalPage=lazy(()=>import('../features/native-workers/NativeWorkerProfessionalPage').then(m=>({default:m.NativeWorkerProfessionalPage})));
const NativeEquipmentPage=lazy(()=>import('../features/native-equipment/NativeEquipmentPage').then(m=>({default:m.NativeEquipmentPage})));
const WorkerDetailPage=lazy(()=>import('../features/workers').then(m=>({default:m.WorkerDetailPage})));
const WorkerMovementPage=lazy(()=>import('../features/workers').then(m=>({default:m.WorkerMovementPage})));
const OrganizationPage=lazy(()=>import('../features/organization').then(m=>({default:m.OrganizationPage})));
const NativeOrganizationPage=lazy(()=>import('../features/organization/NativeOrganizationPage').then(m=>({default:m.NativeOrganizationPage})));
const DashboardPage=lazy(()=>import('../features/dashboard').then(m=>({default:m.DashboardPage})));
const NotificationsPage=lazy(()=>import('../features/notifications').then(m=>({default:m.NotificationsPage})));
const AuditPage=lazy(()=>import('../features/audit').then(m=>({default:m.AuditPage})));
const UsersPage=lazy(()=>import('../features/administration').then(m=>({default:m.UsersPage})));
const NativeUsersPage=lazy(()=>import('../features/administration/NativeUsersPage').then(m=>({default:m.NativeUsersPage})));
const NativeNotificationsPage=lazy(()=>import('../features/notifications/NativeNotificationsPage').then(m=>({default:m.NativeNotificationsPage})));
const NativeAuditPage=lazy(()=>import('../features/audit/NativeAuditPage').then(m=>({default:m.NativeAuditPage})));
const NativeDashboardPage=lazy(()=>import('../features/dashboard/NativeDashboardPage').then(m=>({default:m.NativeDashboardPage})));
const NativeAgendaPage=lazy(()=>import('../features/native-operations/NativeAgendaPage').then(m=>({default:m.NativeAgendaPage})));
const NativeTrainingPage=lazy(()=>import('../features/native-training/NativeTrainingPage').then(m=>({default:m.NativeTrainingPage})));
const NativeAppointmentDetail=lazy(()=>import('../features/native-operations/NativeAppointmentDetail').then(m=>({default:m.NativeAppointmentDetail})));
const NativeCreationPage=lazy(()=>import('../features/native-operations/NativeCreationPage').then(m=>({default:m.NativeCreationPage})));
const NativeTeamsPage=lazy(()=>import('../features/native-operations/NativeTeamsPage').then(m=>({default:m.NativeTeamsPage})));
const NativeTeamFormPage=lazy(()=>import('../features/native-teams/NativeTeamFormPage').then(m=>({default:m.NativeTeamFormPage})));
const NativeDesignationsPage=lazy(()=>import('../features/native-operations/NativeDesignationsPage').then(m=>({default:m.NativeDesignationsPage})));
const NativePermitsPage=lazy(()=>import('../features/native-permits/NativePermitsPage').then(m=>({default:m.NativePermitsPage})));
const NativePermitDetail=lazy(()=>import('../features/native-permits/NativePermitDetail').then(m=>({default:m.NativePermitDetail})));
const NativePermitPrintPage=lazy(()=>import('../features/native-permits/NativePermitDetail').then(m=>({default:m.NativePermitPrintPage})));
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
const SignatureProfilePage=lazy(()=>import('../features/signature-profile/SignatureProfilePage').then(m=>({default:m.SignatureProfilePage})));
const AccountActivationPage=lazy(()=>import('../features/auth/AccountActivationPage').then(m=>({default:m.AccountActivationPage})));
const ConnectedAccountPage=lazy(()=>import('../features/auth/ConnectedAccountPage').then(m=>({default:m.ConnectedAccountPage})));
export function Guard({ permission,children }: { permission?: string; children:ReactNode }) {
  const s=useSession(); if(s.status==='restoring') return <Spinner/>;
  if(!s.me) return <Navigate to="/login" replace/>;
  if(permission&&!s.can(permission)) return <div className="error-page"><h1>Esta área precisa de autorização.</h1><p>Seu perfil não possui acesso a esta funcionalidade. Solicite a concessão ao responsável.</p><Link to="/app" className="button button--primary">Voltar ao início</Link></div>;
  return children;
}
function Home() { const s=useSession(); return <Navigate replace to={homePath(s.can, NATIVE_MODULES)}/>; }
function Connection() { const s=useSession(); const target=homePath(s.can, NATIVE_MODULES); return API_MODE === 'demo' && target !== '/app/conexao' ? <Navigate replace to={target}/> : <ConnectedAccountPage/>; }
function UserWorkspace() { const s=useSession(); return !NATIVE_MODULES && s.can('users.manage') ? <Guard permission="users.manage"><UsersPage/></Guard> : <Guard permission="users.read"><NativeUsersPage/></Guard>; }
export function App() {
  const location = useLocation(); const session = useSession();
  return <AppErrorBoundary resetKey={`${location.key}:${session.sessionKey}:${session.unitId}`}><Suspense fallback={<Spinner/>}><RoutePresentation contextKey={`${session.sessionKey}:${session.unitId}`} /><Routes>
    <Route path="/login" element={<LoginPage/>}/><Route path="/mfa" element={<Navigate to="/login" replace/>}/>
    <Route path="/recuperar-acesso" element={<RecoveryPage/>}/><Route path="/redefinir-senha" element={<ResetPasswordPage/>}/>
    <Route path="/reset-password" element={<ResetPasswordPage/>}/>
    <Route path="/ativar-acesso" element={<AccountActivationPage/>}/>
    <Route path="/convite/:token" element={<TeamInvitePage/>}/>
    <Route path="/app/conexao" element={<Guard><Connection/></Guard>}/>
    <Route path="/app" element={<Guard><AppLayout/></Guard>}>
      <Route index element={<Home/>}/>
      <Route path="consulta" element={<Guard><ConsultationPage/></Guard>}/>
      <Route path="minha-representacao" element={<Guard permission="permits.review"><SignatureProfilePage/></Guard>}/>
      <Route path="dashboard" element={NATIVE_MODULES ? <Guard><NativeDashboardPage/></Guard> : <Guard permission="dashboard.read"><OperationsDashboardPage/></Guard>}/>
      <Route path="epis" element={NATIVE_MODULES ? <Guard permission="epi:ler"><NativeEquipmentPage/></Guard> : <Navigate to="/app/dashboard?area=epis" replace/>}/>
      <Route path="treinamentos" element={NATIVE_MODULES ? <Guard permission="treinamento:ler"><NativeTrainingPage/></Guard> : <Navigate to="/app/dashboard?area=saude&healthView=nrs" replace/>}/>
      <Route path="painel-documental" element={<Guard permission="dashboard.read"><DashboardPage/></Guard>}/>
      <Route path="agenda" element={NATIVE_MODULES?<Guard><NativeAgendaPage/></Guard>:<Guard permission="appointments.read"><AgendaPage/></Guard>}/>
      <Route path="agenda/novo" element={NATIVE_MODULES?<Guard><NativeCreationPage kind="appointment"/></Guard>:<Guard permission="appointments.write"><AppointmentFormPage/></Guard>}/>
      <Route path="agenda/:id" element={NATIVE_MODULES?<Guard><NativeAppointmentDetail/></Guard>:<Guard permission="appointments.read"><AppointmentDetailPage/></Guard>}/>
      <Route path="equipes" element={NATIVE_MODULES?<Guard permission="equipe:ler"><NativeTeamsPage/></Guard>:<Guard permission="teams.read"><TeamsPage/></Guard>}/>
      <Route path="equipes/novo" element={NATIVE_MODULES?<Guard permission="equipe:criar"><NativeTeamFormPage/></Guard>:<Guard permission="teams.write"><TeamFormPage/></Guard>}/>
      <Route path="equipes/:id/editar" element={NATIVE_MODULES?<Guard permission="equipe:editar"><NativeTeamFormPage/></Guard>:<Guard permission="teams.write"><TeamFormPage/></Guard>}/>
      <Route path="pts" element={NATIVE_MODULES?<Guard><NativePermitsPage/></Guard>:<Guard permission="permits.read"><PermitsPage/></Guard>}/>
      <Route path="pts/:id" element={NATIVE_MODULES?<Guard><NativePermitDetail/></Guard>:<Guard permission="permits.read"><PermitDetailPage/></Guard>}/>
      <Route path="pts/:id/imprimir" element={NATIVE_MODULES?<Guard><NativePermitPrintPage/></Guard>:<Guard permission="permits.read"><PermitPrintPage/></Guard>}/>
      <Route path="designacoes" element={NATIVE_MODULES?<Guard><NativeDesignationsPage/></Guard>:<Guard permission="appointments.read"><DesignationsPage/></Guard>}/>
      <Route path="designacoes/nova" element={NATIVE_MODULES?<Guard><NativeCreationPage kind="designation"/></Guard>:<Guard permission="appointments.write"><DesignationFormPage/></Guard>}/>
      <Route path="designacoes/:id" element={NATIVE_MODULES?<Guard><NativeDesignationsPage/></Guard>:<Guard permission="appointments.read"><DesignationDetailPage/></Guard>}/>
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
      <Route path="documentos/novo" element={NATIVE_MODULES ? <Guard permission="documento:criar"><NativeDocumentCreate/></Guard> : <Guard permission="documents.write"><DocumentFormPage/></Guard>}/>
      <Route path="documentos/:id" element={<Guard permission="documents.read">{NATIVE_MODULES ? <NativeDocumentDetail/> : <DocumentDetailPage/>}</Guard>}/>
      <Route path="documentos/:id/editar" element={NATIVE_MODULES ? <Guard permission="documento:editar"><NativeDocumentDetail initialEdit/></Guard> : <Guard permission="documents.write"><DocumentFormPage/></Guard>}/>
      <Route path="documentos/:id/versoes/nova" element={NATIVE_MODULES ? <Guard permission="documento:editar"><NativeDocumentDetail initialUpload/></Guard> : <Guard permission="documents.write"><VersionFormPage/></Guard>}/>
      <Route path="trabalhadores" element={<Guard permission="workers.read"><WorkersPage/></Guard>}/>
      <Route path="trabalhadores/novo" element={NATIVE_MODULES ? <Guard permission="trabalhador:criar"><NativeWorkerCreate/></Guard> : <Guard permission="workers.write"><WorkerFormPage/></Guard>}/>
      <Route path="trabalhadores/:id" element={<Guard permission="workers.read"><WorkerDetailPage/></Guard>}/>
      <Route path="trabalhadores/:id/conta" element={NATIVE_MODULES ? <Guard permission="trabalhador:editar"><NativeWorkerAccountPage/></Guard> : <Navigate to="/app/trabalhadores" replace/>}/>
      <Route path="trabalhadores/:id/editar" element={NATIVE_MODULES ? <Guard permission="trabalhador:editar"><NativeWorkerProfessionalPage/></Guard> : <Guard permission="workers.write"><WorkerFormPage/></Guard>}/>
      <Route path="trabalhadores/:id/movimentacoes/nova" element={<Guard permission="workers.write"><WorkerMovementPage/></Guard>}/>
      <Route path="organizacao" element={<Guard permission="organization.read">{NATIVE_MODULES ? <NativeOrganizationPage/> : <OrganizationPage/>}</Guard>}/>
      <Route path="notificacoes" element={<Guard permission="notifications.read">{NATIVE_MODULES ? <NativeNotificationsPage/> : <NotificationsPage/>}</Guard>}/>
      <Route path="auditoria" element={<Guard permission="audit.read">{NATIVE_MODULES ? <NativeAuditPage/> : <AuditPage/>}</Guard>}/>
      <Route path="configuracoes/usuarios" element={<Guard><UserWorkspace/></Guard>}/>
      <Route path="configuracoes/tipos-documentais" element={<Guard permission="documentTypes.write"><DocumentTypesPage/></Guard>}/>
      <Route path="configuracoes/parametros" element={<Guard><ParametersPage/></Guard>}/>
      <Route path="configuracoes/requisitos" element={<Guard permission="requirements.read"><RequirementMatrixPage/></Guard>}/>
      <Route path="configuracoes/servicos" element={<Guard permission="requirements.read"><ServiceTemplatesPage/></Guard>}/>
    </Route>
    <Route path="/" element={<Navigate to="/app" replace/>}/>
    <Route path="*" element={<div className="error-page"><h1>Página não encontrada.</h1><p>O endereço pode ter sido alterado.</p><Link to="/app" className="button button--primary">Voltar ao início</Link></div>}/>
  </Routes></Suspense></AppErrorBoundary>;
}
