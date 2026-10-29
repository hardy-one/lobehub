import { resolveObjectPath, respondWithArtifact } from '../../handler';

type Params = Promise<{ id: string; path: string[] }>;

/**
 * Public renderer for a deployed Artifact: GET /artifact-render/:id/:path*
 *
 * NOTE: intentionally unauthenticated — the deployment id is the capability,
 * and the contents are rendered inside a sandboxed iframe on a visitor's page.
 */
export const GET = async (_request: Request, segmentData: { params: Params }) => {
  try {
    const { id, path } = await segmentData.params;

    const objectPath = resolveObjectPath(path);

    if (objectPath === null) {
      return new Response('Invalid path', { status: 400 });
    }

    return await respondWithArtifact(id, objectPath);
  } catch (error) {
    console.error('Artifact render error:', error);

    return new Response('Internal server error', { status: 500 });
  }
};
