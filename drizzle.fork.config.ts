import type { Config } from 'drizzle-kit';

export default {
  dialect: 'postgresql',
  out: './packages/database/migrations-fork',
  schema: './packages/database/src/schemas/artifactDeployment.ts',
  strict: true,
} satisfies Config;
