import { readFileSync, readdirSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const migrationRoot = new URL('./supabase/migrations/', import.meta.url);
    const migrations = () => readdirSync(migrationRoot).filter(name => name.endsWith('.sql')).sort();
    const readMigration = name => readFileSync(new URL(name, migrationRoot), 'utf8');
    const setupSql = () => migrations().map(readMigration).join('\n');
    return {
        base: env.VITE_BASE_PATH || './',
        publicDir: false,
        plugins: [tailwindcss(), {
            name: 'pos-database-setup',
            generateBundle() {
                this.emitFile({ type: 'asset', fileName: 'setup.sql', source: setupSql() });
                this.emitFile({ type: 'asset', fileName: '.nojekyll', source: '' });
                for (const name of migrations()) this.emitFile({ type: 'asset', fileName: 'updates/' + name, source: readMigration(name) });
            },
            configureServer(server) {
                server.middlewares.use((request, response, next) => {
                    if (request.url?.split('?')[0].endsWith('/setup.sql')) {
                        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
                        response.end(setupSql());
                    } else if (request.url?.split('?')[0].includes('/updates/')) {
                        const name = request.url.split('?')[0].split('/').at(-1);
                        if (!migrations().includes(name)) return next();
                        response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.end(readMigration(name));
                    } else next();
                });
            },
        }],
        server: { host: '127.0.0.1', port: 5173 },
        preview: { host: '127.0.0.1', port: 4173 },
        build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
    };
});
