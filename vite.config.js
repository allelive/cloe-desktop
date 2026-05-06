import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
  // publicDir: 'public' — needed for dev server to serve GIFs/audio/references.
  // Build cleanup: Vite copies public/ wholesale first, then we remove _work_* from dist.
  publicDir: 'public',
  plugins: [
    {
      name: 'copy-public-assets',
      apply: 'build',
      closeBundle() {
        const dest = path.resolve('dist');

        // Remove all _work_* directories recursively (Vite copies public/ wholesale)
        function cleanWorkDirs(dir) {
          if (!fs.existsSync(dir)) return;
          for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
              if (ent.name.startsWith('_work_')) {
                fs.rmSync(full, { recursive: true, force: true });
                console.log(`[build-cleanup] Removed ${full}`);
              } else {
                cleanWorkDirs(full);
              }
            } else if (ent.name.endsWith('_raw.gif') || ent.name.startsWith('palette_')) {
              fs.unlinkSync(full);
              console.log(`[build-cleanup] Removed ${full}`);
            }
          }
        }
        cleanWorkDirs(path.join(dest, 'gifs'));
        console.log('[build-cleanup] Done');
      },
    },
  ],
});
