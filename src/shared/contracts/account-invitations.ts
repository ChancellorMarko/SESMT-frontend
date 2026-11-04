/** Proposed account-activation contracts. The real identity API must homologate them. */
export interface AccountInvitationInspectDto {
  invitationId: string;
  displayName: string;
  emailMasked: string;
  expiresAt: string;
  mfaRequired: boolean;
  passwordPolicy: { minLength: number; maxLength: number };
}

export interface AccountInvitationAcceptDto {
  invitationId: string;
  nextStep: 'LOGIN' | 'MFA_SETUP_REQUIRED' | 'WORKER_LINK_REQUIRED';
}

export interface AccountInvitationSummaryDto {
  userId: string;
  userRevision: number;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  expiresAt: string;
  mfaRequired: boolean;
  deliveryStatus: 'PENDING' | 'SENT' | 'FAILED' | 'SIMULATED';
  /** Local MSW demonstration only. A real API must never return a delivery token here. */
  demoActivationPath?: string;
}
