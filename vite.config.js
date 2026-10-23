import { defineConfig } from 'vite';
import fs from 'node:fs';

const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
export default defineConfig({
  base: repo ? `/${repo}/` : '/',
  plugins: [{
    name: 'local-private-preview',
    configureServer(server) {
      server.middlewares.use('/__demo', (_request, response) => {
        try {
          const data = fs.readFileSync(new URL('./demo-data.private.json', import.meta.url));
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.end(data);
        } catch {
          response.statusCode = 404;
          response.end('Run npm run prepare:demo');
        }
      });
    },
  }],
});
