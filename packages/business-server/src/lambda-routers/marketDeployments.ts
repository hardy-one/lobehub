import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  ArtifactDeploymentService,
  isArtifactDeploymentEnabled,
} from '@/server/services/artifactDeployment';

const kindSchema = z.enum(['html', 'react']);

const uploadFileSchema = z.object({
  contentType: z.string(),
  path: z.string(),
  sizeBytes: z.number().nonnegative(),
});

const manifestSchema = z.record(
  z.string(),
  z.object({ contentType: z.string(), size: z.number().nonnegative() }),
);

/**
 * Every procedure is scoped to the caller's personal or workspace data, and the
 * whole surface is opt-in per deployment: a self-hosted install that does not
 * set `OSS_ENABLE_ARTIFACT_DEPLOYMENT` offers no publishing at all.
 */
const deploymentProcedure = authedProcedure.use(serverDatabase).use((opts) => {
  if (!isArtifactDeploymentEnabled())
    throw new TRPCError({
      code: 'NOT_IMPLEMENTED',
      message: 'Artifact deployment is not enabled on this deployment',
    });

  return opts.next({
    ctx: {
      deploymentService: new ArtifactDeploymentService(
        opts.ctx.serverDB,
        opts.ctx.userId,
        opts.ctx.workspaceId ?? undefined,
      ),
    },
  });
});

export const marketDeploymentsRouter = router({
  commitWorkspaceHtmlUpload: deploymentProcedure
    .input(
      z.object({
        buildMs: z.number().optional(),
        contentHash: z.string().optional(),
        entry: z.string().optional(),
        identifier: z.string(),
        kind: kindSchema,
        manifest: manifestSchema,
        messageId: z.string().optional(),
        source: z.string().optional(),
        title: z.string().optional(),
        topicId: z.string(),
        uploadId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.deploymentService.commitUpload(input)),

  getExisting: deploymentProcedure
    .input(z.object({ identifier: z.string(), topicId: z.string() }))
    .query(async ({ ctx, input }) => ctx.deploymentService.getExisting(input)),

  listByTopic: deploymentProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ ctx, input }) => ctx.deploymentService.listByTopic(input.topicId)),

  prepareWorkspaceHtmlUpload: deploymentProcedure
    .input(
      z.object({
        files: z.array(uploadFileSchema),
        identifier: z.string(),
        kind: kindSchema,
        requestedSlug: z.string().optional(),
        title: z.string().optional(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.deploymentService.prepareUpload(input)),

  publishArtifact: deploymentProcedure
    .input(
      z.object({
        identifier: z.string(),
        messageId: z.string(),
        requestedSlug: z.string().optional(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.deploymentService.publishArtifact(input)),

  setCurrentRevision: deploymentProcedure
    .input(z.object({ id: z.string(), revision: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => ctx.deploymentService.setCurrentRevision(input)),

  unpublish: deploymentProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => ctx.deploymentService.unpublish(input)),
});
