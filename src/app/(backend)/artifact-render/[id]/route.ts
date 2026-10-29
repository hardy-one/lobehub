import { respondWithArtifact } from '../handler';

type Params = Promise<{ id: string }>;

/**
 * Bare deployment address: serves the entry file.
 *
 * This lives in its own route rather than behind an optional catch-all: the
 * framework appends a trailing slash to that root form and then strips it again,
 * which loops. `iframeSrc` names the entry explicitly anyway, so this is only a
 * convenience for a hand-typed link.
 */
export const GET = async (_request: Request, segmentData: { params: Params }) => {
  try {
    const { id } = await segmentData.params;

    return await respondWithArtifact(id, '');
  } catch (error) {
    console.error('Artifact render error:', error);

    return new Response('Internal server error', { status: 500 });
  }
};
