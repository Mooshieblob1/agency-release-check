// Dependency-free synthetic agency site. It is the only target capture can reach.
// The "baseline" variant is the approved release; "candidate" introduces known
// visual changes and browser problems so the pipeline has something to find.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

export type FixtureVariant = 'baseline' | 'candidate';

export const FIXTURE_HOST = '127.0.0.1';
export const FIXTURE_PORT = 4317;
export const FIXTURE_ORIGIN = `http://${FIXTURE_HOST}:${FIXTURE_PORT}`;

export interface FixtureHandle {
  readonly origin: string;
  variant: FixtureVariant;
  readonly requests: string[];
  close(): Promise<void>;
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d2433;background:#f7f7f4}
header{display:flex;gap:24px;align-items:center;padding:16px 32px;background:#1d2433;color:#fff}
header a{color:#fff;text-decoration:none}
nav{display:flex;gap:16px;flex-wrap:wrap}
main{max-width:960px;margin:0 auto;padding:32px}
h1{font-size:40px;line-height:1.15;margin:0 0 16px}
.hero{padding:48px 32px;background:#dfe9f3;border-radius:12px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:24px}
.card{background:#fff;border:1px solid #d5d8de;border-radius:8px;padding:16px}
.price{font-size:32px;font-weight:700}
.updated{color:#5b6475;font-size:14px}
footer{padding:24px 32px;color:#5b6475;border-top:1px solid #d5d8de}
form label{display:block;margin-top:12px}
form input,form textarea{width:100%;padding:8px;border:1px solid #9aa1ad;border-radius:4px}
@media (max-width:600px){header{flex-direction:column;align-items:flex-start;padding:16px}main{padding:16px}h1{font-size:30px}}
`;

const CANDIDATE_CSS = `
.pricing .cards{grid-template-columns:1fr}
.pricing .card.featured{border:3px solid #c2410c}
`;

function layout(variant: FixtureVariant, title: string, bodyClass: string, body: string, extraHead = ''): string {
  // The timestamp differs on every request; configs declare it as a mask.
  const updated = new Date().toISOString();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | Example Studio</title>
<link rel="stylesheet" href="/assets/site.css">${variant === 'candidate' ? '<link rel="stylesheet" href="/assets/candidate.css">' : ''}
${extraHead}</head>
<body class="${bodyClass}">
<header><a href="/"><strong>Example Studio</strong></a>
<nav aria-label="Main"><a href="/services">Services</a><a href="/about">About</a><a href="/pricing">Pricing</a><a href="/contact">Contact</a></nav></header>
<main>${body}<p class="updated" data-volatile="updated">Content refreshed ${updated}</p></main>
<footer>Synthetic fixture site. <a href="https://example.com/partner">Partner directory</a></footer>
</body></html>`;
}

function page(variant: FixtureVariant, path: string): string | undefined {
  const candidate = variant === 'candidate';
  switch (path) {
    case '/':
      return layout(variant, 'Home', 'home', `<section class="hero">
<h1>${candidate ? 'Websites that launch on time, every time' : 'Websites built for small teams'}</h1>
<p>We design, build and maintain fast websites for local organisations.</p></section>
<div class="cards"><div class="card">Design</div><div class="card">Build</div><div class="card">Care plans</div></div>`);
    case '/services':
      return layout(variant, 'Services', 'services', `<h1>Services</h1>
<ul><li>Discovery workshops</li><li>Content design</li><li>Accessible front-end builds</li><li>Monthly care plans</li></ul>
<p id="status">Service status: checking…</p>`,
      // Candidate calls an API endpoint that fails.
      candidate ? '<script src="/assets/status.js" defer></script>' : '');
    case '/about':
      return layout(variant, 'About', 'about', `<h1>About the studio</h1>
<p>A small team working across design and engineering.</p>
${candidate ? '<img src="/assets/studio-photo.png" alt="The studio workspace" width="320" height="200">' : ''}`);
    case '/pricing':
      return layout(variant, 'Pricing', 'pricing', `<h1>Pricing</h1>
<div class="cards"><div class="card"><h2>Starter</h2><p class="price">$1,200</p></div>
<div class="card featured"><h2>Growth</h2><p class="price">$2,800</p></div>
<div class="card"><h2>Care</h2><p class="price">$150/mo</p></div></div>`);
    case '/contact':
      return layout(variant, 'Contact', 'contact', `<h1>Contact</h1>
<form action="/contact" method="post" novalidate><label>Your message<textarea name="message" rows="4"></textarea></label>
<p><button type="submit">Send</button></p></form>`,
      candidate ? '<script src="/assets/contact.js" defer></script>' : '');
    default:
      return undefined;
  }
}

const SCRIPTS: Record<string, string> = {
  '/assets/status.js': `fetch('/api/status').then(r=>{if(!r.ok)throw new Error('status '+r.status);return r.json()})
.then(d=>{document.getElementById('status').textContent='Service status: '+d.state})
.catch(e=>{console.error('Status widget failed:',e.message);document.getElementById('status').textContent='Service status: unavailable'});`,
  '/assets/contact.js': `document.querySelector('form').addEventListener('submit',e=>e.preventDefault());
window.contactConfig.endpoint;`,
};

function send(res: ServerResponse, status: number, type: string, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'",
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

export function handleFixtureRequest(variant: FixtureVariant, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', FIXTURE_ORIGIN);
  const path = url.pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'text/plain; charset=utf-8', 'Fixture is read-only', { allow: 'GET, HEAD' });
    return;
  }
  if (path === '/old-services') {
    send(res, 301, 'text/plain; charset=utf-8', 'Moved', { location: '/services' });
    return;
  }
  if (path === '/assets/site.css') return send(res, 200, 'text/css; charset=utf-8', CSS);
  if (path === '/assets/candidate.css' && variant === 'candidate') return send(res, 200, 'text/css; charset=utf-8', CANDIDATE_CSS);
  const script = variant === 'candidate' ? SCRIPTS[path] : undefined;
  if (script) return send(res, 200, 'text/javascript; charset=utf-8', script);
  if (path === '/api/status') {
    return variant === 'candidate'
      ? send(res, 500, 'application/json', '{"error":"upstream unavailable"}')
      : send(res, 200, 'application/json', '{"state":"operational"}');
  }
  const html = page(variant, path);
  if (html) return send(res, 200, 'text/html; charset=utf-8', html);
  send(res, 404, 'text/plain; charset=utf-8', 'Not found');
}

export async function startFixture(variant: FixtureVariant, port = FIXTURE_PORT): Promise<FixtureHandle> {
  const requests: string[] = [];
  const handle: FixtureHandle = {
    origin: `http://${FIXTURE_HOST}:${port}`,
    variant,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
  const server: Server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    handleFixtureRequest(handle.variant, req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, FIXTURE_HOST, () => resolve());
  });
  return handle;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = process.argv[2] ?? 'baseline';
  if (arg !== 'baseline' && arg !== 'candidate') {
    console.error('Usage: node --import tsx src/fixture.ts [baseline|candidate]');
    process.exit(2);
  }
  const fixture = await startFixture(arg);
  console.log(`Fixture (${arg}) listening on ${fixture.origin}. Stop with Ctrl+C.`);
  const stop = () => void fixture.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
