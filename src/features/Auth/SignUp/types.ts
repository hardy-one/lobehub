export interface BaseSignUpFormValues {
  confirmPassword: string;
  email: string;
  /** Only asked for, and only required, when the server gates sign-up on it. */
  invitationCode: string;
  password: string;
}
