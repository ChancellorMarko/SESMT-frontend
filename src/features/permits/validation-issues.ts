/** A local validation failure tied to a stable control path, independent of UI IDs. */
export interface PermitValidationIssue {
  path: string;
  message: string;
}
