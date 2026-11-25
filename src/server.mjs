import http from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { Store } from './store.mjs';
import { AppError } from './auth.mjs';
import { generate } from './synthetic.mjs';
import { reportCSV } from './export.mjs';
export async function createApp(options = {}) {
  const store = new Store(options.database ?? 'data/cutover.sqlite', options);
  let origin;
  const staticFiles = {
    '/contract.json': ['contract.json', 'application/json'],
    '/': ['index.html', 'text/html'],
    '/app.js': ['app.js', 'text/javascript'],
    '/styles.css': ['styles.css', 'text/css'],
    '/details.css': ['details.css', 'text/css'],
    '/vendor/bootstrap.min.css': ['vendor/bootstrap.min.css', 'text/css'],
  };
  const server = http.createServer(
    { maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000 },
    async (req, res) => {
      const requestId = randomUUID();
      res.setHeader('x-request-id', requestId);
      res.setHeader('cache-control', 'no-store');
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('referrer-policy', 'no-referrer');
      res.setHeader(
        'content-security-policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      const send = (status, data) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
      };
      try {
        if (req.headers.host !== new URL(origin).host)
          throw new AppError(403, 'Invalid request host');
        const path = new URL(req.url, origin).pathname;
        if (req.method === 'GET' && ['/healthz', '/readyz'].includes(path)) {
          store.db.prepare('SELECT 1').get();
          return send(200, { status: 'ready', mode: 'synthetic-offline' });
        }
        if (req.method === 'GET' && Object.hasOwn(staticFiles, path)) {
          const [name, type] = staticFiles[path];
          res.writeHead(200, { 'content-type': type + '; charset=utf-8' });
          return res.end(await fs.readFile(new URL('../public/' + name, import.meta.url)));
        }
        if (!['GET', 'POST'].includes(req.method)) throw new AppError(405, 'Method not allowed');
        const write = req.method === 'POST';
        let body = {};
        if (write) {
          if (
            req.headers.origin !== origin ||
            req.headers['content-type']?.split(';')[0] !== 'application/json'
          )
            throw new AppError(403, 'Same-origin JSON request required');
          let size = 0;
          const parts = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 8388608) throw new AppError(413, 'Request exceeds 8 MB');
            parts.push(chunk);
          }
          try {
            body = JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)),
            );
          } catch {
            throw new AppError(400, 'Invalid JSON or UTF-8');
          }
          if (!body || Array.isArray(body) || typeof body !== 'object')
            throw new AppError(422, 'JSON object required');
        }
        if (write && path === '/api/login') {
          const session = store.login(body.username, body.password, req.socket.remoteAddress);
          res.setHeader(
            'set-cookie',
            `cutover_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400`,
          );
          return send(200, { user: session.user, csrf: session.csrf });
        }
        const cookie = (req.headers.cookie ?? '')
          .split(';')
          .map((s) => s.trim())
          .find((s) => s.startsWith('cutover_session='))
          ?.slice(16);
        const session = store.session(cookie);
        if (write && req.headers['x-csrf-token'] !== session.csrf)
          throw new AppError(403, 'Invalid request token');
        const requireRole = (roles) => {
          if (!roles.includes(session.role))
            throw new AppError(403, 'Your role cannot perform this action');
        };
        if (!write && path === '/api/me')
          return send(200, {
            user: { id: session.id, username: session.username, role: session.role },
            csrf: session.csrf,
            mode: 'synthetic-offline',
          });
        if (write && path === '/api/logout') {
          store.logout(cookie);
          res.setHeader(
            'set-cookie',
            'cutover_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
          );
          return send(200, { ok: true });
        }
        if (write && path === '/api/password') {
          store.changePassword(session.id, body.currentPassword, body.newPassword);
          return send(200, { ok: true });
        }
        if (path === '/api/users') {
          requireRole(['admin']);
          if (!write) return send(200, store.users());
          return send(201, store.createUser(body, session.username));
        }
        const disable = path.match(/^\/api\/users\/([a-zA-Z0-9-]+)\/disable$/);
        if (write && disable) {
          requireRole(['admin']);
          store.disableUser(disable[1], session.username, body.reason);
          return send(200, { ok: true });
        }
        if (!write && path === '/api/audit') return send(200, store.listAudit());
        if (!write && path === '/api/summary') return send(200, store.summary());
        if (write && path === '/api/synthetic') {
          requireRole(['admin', 'operator']);
          return send(200, generate(body.count ?? 12, body.scenario ?? 'clean'));
        }
        if (path === '/api/runs') {
          if (!write) return send(200, store.listRuns());
          requireRole(['admin', 'operator']);
          store.rate('runs:' + session.id, 12);
          const result = store.createRun(body, req.headers['idempotency-key'], session.username);
          return send(result.created ? 201 : 200, result);
        }
        const match = path.match(
          /^\/api\/runs\/([a-zA-Z0-9-]+)(?:\/(approve|report|bundle|csv))?$/,
        );
        if (match) {
          const [, id, action] = match;
          if (write && action === 'approve') {
            requireRole(['admin']);
            return send(200, store.approve(id, body.reportHash, body.reason, session.username));
          }
          if (!write) {
            const run = store.run(id);
            if (action === 'csv') {
              res.writeHead(200, {
                'content-type': 'text/csv; charset=utf-8',
                'content-disposition': 'attachment; filename="rehearsal-' + id + '.csv"',
              });
              return res.end(reportCSV(run.report));
            }
            if (['report', 'bundle'].includes(action)) {
              res.setHeader(
                'content-disposition',
                'attachment; filename="' + action + '-' + id + '.json"',
              );
              return send(
                200,
                action === 'report'
                  ? { ...run.report, reportHash: run.reportHash, review: run.review }
                  : run.bundle,
              );
            }
            if (!action) return send(200, run);
          }
        }
        throw new AppError(404, 'Route not found');
      } catch (error) {
        const status =
          Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
            ? error.status
            : 500;
        if (status === 500) options.onError?.({ requestId, code: error.code ?? 'internal_error' });
        if (!res.headersSent)
          send(status, { error: status === 500 ? 'Request failed' : error.message, requestId });
        else res.destroy();
      }
    },
  );
  server.on('clientError', (_error, socket) =>
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'),
  );
  return {
    store,
    server,
    get origin() {
      return origin;
    },
    async listen(port = 4312) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      origin = 'http://127.0.0.1:' + server.address().port;
      return origin;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
  };
}
