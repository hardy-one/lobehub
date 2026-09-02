'use client';

import { ChatHeader } from '@lobehub/ui/mobile';
import { memo, Suspense } from 'react';
import { useParams } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import ProfileSkeleton from '@/components/Skeleton/Profile';
import { AgentNotFoundGuard } from '@/features/AgentNotFound';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import AgentIdSync from '@/routes/(main)/agent/_layout/AgentIdSync';
import EditLockDriver from '@/routes/(main)/agent/profile/features/EditLockDriver';
import ProfileEditor from '@/routes/(main)/agent/profile/features/ProfileEditor';
import ProfileHydration from '@/routes/(main)/agent/profile/features/ProfileHydration';
import ProfileProvider from '@/routes/(main)/agent/profile/features/ProfileProvider';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

const MobileProfileHeader = memo(() => {
  const { aid } = useParams<{ aid: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const title = useAgentStore(agentSelectors.currentAgentDisplayName);

  return (
    <ChatHeader
      showBackButton
      center={<ChatHeader.Title title={title} />}
      onBackClick={() => navigate(`/agent/${aid ?? ''}`)}
    />
  );
});

MobileProfileHeader.displayName = 'MobileProfileHeader';

const MobileAgentProfile = memo(() => {
  const { aid } = useParams<{ aid: string }>();

  return (
    <>
      <MobileContentLayout header={<MobileProfileHeader />}>
        <Suspense fallback={<ProfileSkeleton />}>
          <AgentNotFoundGuard>
            <ResourceConfigAccessGate
              loading={<ProfileSkeleton />}
              redirectPath={`/agent/${aid ?? ''}`}
              resourceId={aid}
              resourceType="agent"
            >
              <ProfileProvider>
                <WideScreenContainer>
                  <ProfileEditor />
                </WideScreenContainer>
              </ProfileProvider>
            </ResourceConfigAccessGate>
          </AgentNotFoundGuard>
        </Suspense>
      </MobileContentLayout>
      <EditLockDriver />
      <ProfileHydration />
      <AgentIdSync />
    </>
  );
});

MobileAgentProfile.displayName = 'MobileAgentProfile';

export default MobileAgentProfile;
