export type StoreKind = 'memory' | 'postgres';

export interface AppConfig {
  readonly port: number;
  readonly logLevel: string;
  readonly store: StoreKind;
  readonly databaseUrl: string | null;
  readonly seedDemoData: boolean;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const store: StoreKind = env.STORE === 'postgres' ? 'postgres' : 'memory';
  return {
    port: Number(env.PORT ?? 3000),
    logLevel: env.LOG_LEVEL ?? 'info',
    store,
    databaseUrl: store === 'postgres' ? required('DATABASE_URL', env.DATABASE_URL) : null,
    seedDemoData: env.SEED_DEMO_DATA !== 'false' && store === 'memory',
  };
}
