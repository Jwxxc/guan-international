import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Static sharing edition: never start the regular game's native services.
export default defineConfig({
  base: process.env.GUAN_BASE_PATH || '/',
  plugins: [react()],
  define: { 'import.meta.env.GUAN_PRO_NATIVE_ENABLED': 'false', 'import.meta.env.GUAN_DISTRIBUTION': JSON.stringify('portable') },
  server: {
    host: '127.0.0.1', port: 5191, strictPort: true,
    watch: { ignored: ['**/artifacts/**', '**/test-results/**', '**/dist/**', `${process.cwd()}/outputs/**`] },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/models/private/**', '**/artifacts/**', '**/data/**', '**/training/**', '**/scripts/**', `${process.cwd()}/outputs/**`] },
  },
  test: {
    include: ['src/test/{international,patterns,state,persistence,classic-rules,classic-session,arrangement,cardMove,verticalGroups,archive-replay,replay-navigation,player-tiers}.test.ts'],
    environment: 'node',
  },
});
