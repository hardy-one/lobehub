import type { SharedArtifactData } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getPublicArtifact } from '@/server/services/artifactDeployment';

export const artifactShareRouter = router({
  // No session: a published Artifact is reachable by anyone holding its id, so
  // the share page works for anonymous visitors.
  getShared: publicProcedure
    .use(serverDatabase)
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<SharedArtifactData> => {
      const artifact = await getPublicArtifact(ctx.serverDB, input.id);

      if (!artifact) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Artifact not found' });
      }

      return { id: artifact.id, iframeSrc: artifact.iframeSrc, title: artifact.title ?? null };
    }),
});
