'use client';

import DevSeedSignIn from './DevSeedSignIn';
import { SignInEmailSentStep } from './SignInEmailSentStep';
import { SignInEmailStep } from './SignInEmailStep';
import { SignInPasswordStep } from './SignInPasswordStep';
import { useSignIn } from './useSignIn';

const SignIn = () => {
  const {
    agreementChecked,
    continueWithAgreement,
    disableEmailPassword,
    email,
    enableInvitationCode,
    form,
    handleBackFromSent,
    handleBackToEmail,
    handleForgotPassword,
    handleGoToSignup,
    handleResendEmail,
    handleSocialSignIn,
    invitationCode,
    isSocialOnly,
    lastAuthProvider,
    loading,
    oAuthSSOProviders,
    sending,
    sessionExpired,
    sentInfo,
    serverConfigInit,
    setAgreementChecked,
    setInvitationCode,
    socialLoading,
    step,
  } = useSignIn();

  if (step === 'emailSent' && sentInfo)
    return (
      <SignInEmailSentStep
        email={sentInfo.email}
        sending={sending}
        type={sentInfo.type}
        onBack={handleBackFromSent}
        onResend={handleResendEmail}
      />
    );

  if (step === 'password')
    return (
      <SignInPasswordStep
        email={email}
        forgotLoading={sending}
        form={form as any}
        loading={loading}
        onBackToEmail={handleBackToEmail}
        onForgotPassword={handleForgotPassword}
      />
    );

  return (
    <>
      <SignInEmailStep
        agreementChecked={agreementChecked}
        continueWithAgreement={continueWithAgreement}
        disableEmailPassword={disableEmailPassword}
        enableInvitationCode={enableInvitationCode}
        form={form as any}
        invitationCode={invitationCode}
        isSocialOnly={isSocialOnly}
        lastAuthProvider={lastAuthProvider}
        loading={loading}
        oAuthSSOProviders={oAuthSSOProviders}
        serverConfigInit={serverConfigInit}
        sessionExpired={sessionExpired}
        setAgreementChecked={setAgreementChecked}
        socialLoading={socialLoading}
        onGoToSignup={handleGoToSignup}
        onInvitationCodeChange={setInvitationCode}
        onResetEmail={handleBackToEmail}
        onSetPassword={handleForgotPassword}
        onSocialSignIn={handleSocialSignIn}
      />
      <DevSeedSignIn />
    </>
  );
};

export default SignIn;
