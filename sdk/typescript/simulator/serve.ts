/**
 * FlashQ Simulator Server
 *
 * Simple HTTP server to serve the simulator files.
 *
 * Run: bun run simulator/serve.ts
 */

const PORT = 3000;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    // Default to index.html
    if (path === '/') {
      path = '/index.html';
    }

    // Determine content type
    const ext = path.split('.').pop();
    const contentTypes: Record<string, string> = {
      html: 'text/html',
      js: 'application/javascript',
      css: 'text/css',
      json: 'application/json',
      png: 'image/png',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
    };

    const contentType = contentTypes[ext || 'html'] || 'text/plain';

    try {
      const file = Bun.file(`./simulator${path}`);
      const exists = await file.exists();

      if (!exists) {
        return new Response('Not Found', { status: 404 });
      }

      return new Response(file, {
        headers: { 'Content-Type': contentType },
      });
    } catch (error) {
      return new Response('Internal Server Error', { status: 500 });
    }
  },
});

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ⚡ FlashQ Simulator                                         ║
║                                                               ║
║   Server running at: http://localhost:${PORT}                   ║
║                                                               ║
║   Make sure FlashQ server is running with HTTP enabled:       ║
║   HTTP=1 cargo run --release                                  ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);
