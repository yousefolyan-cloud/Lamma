// LOCAL DEVELOPMENT ONLY. A tiny stand-in for the two Supabase HTTP services the app talks to
// (GoTrue password auth + PostgREST), so the real app can run against the real SQL (RLS + RPCs)
// on a developer machine without Docker. It is NOT a production server:
//   * refuses to start unless LAMMA_DEV_GATEWAY=1 and the database host is local
//   * every account shares DEV_PASSWORD; tokens are unsigned
// Production uses a real Supabase project; nothing in the app depends on this file.
import http from 'node:http';
import { Pool } from 'pg';

const env = process.env;
if (env.LAMMA_DEV_GATEWAY !== '1' || env.NODE_ENV === 'production') throw new Error('dev gateway is disabled (set LAMMA_DEV_GATEWAY=1, never in production)');
const host = env.PGHOST ?? 'localhost';
if (!['localhost', '127.0.0.1'].includes(host)) throw new Error('dev gateway only talks to a local database');
const DEV_PASSWORD = env.DEV_PASSWORD;
if (!DEV_PASSWORD) throw new Error('DEV_PASSWORD is required');
const pool = new Pool({ host, port: +(env.PGPORT ?? 5432), user: env.PGUSER ?? 'postgres', password: env.PGPASSWORD, database: env.PGDATABASE ?? 'lamma_dev' });
const ident = /^[a-z_][a-z0-9_]*$/;
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.dev`;
const subOf = (auth?: string) => { try { return JSON.parse(Buffer.from((auth ?? '').replace('Bearer ', '').split('.')[1] ?? '', 'base64url').toString()).sub as string; } catch { return undefined; } };
const session = (u: any) => ({ access_token: token(u.id), token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400,
  refresh_token: 'dev-' + u.id, user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: u.raw_user_meta_data ?? {}, app_metadata: {}, created_at: new Date().toISOString() } });

async function asUser<T>(sub: string | undefined, fn: (q: (t: string, p?: unknown[]) => Promise<any>) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role: 'authenticated' } : { role: 'anon' })]);
    await c.query(`set local role ${sub ? 'authenticated' : 'anon'}`);
    const out = await fn((t, p) => c.query(t, p as any[]));
    await c.query('commit');
    return out;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}

function filters(url: URL, start = 1) {
  const where: string[] = [], params: unknown[] = []; let order = '', limit = '';
  for (const [k, v] of url.searchParams) {
    if (k === 'select') continue;
    if (k === 'order') { order = ' order by ' + v.split(',').map((p) => { const [c, d] = p.split('.'); if (!ident.test(c!)) throw new Error('bad order'); return `${c} ${d === 'desc' ? 'desc' : 'asc'}`; }).join(', '); continue; }
    if (k === 'limit') { limit = ' limit ' + Number(v); continue; }
    if (!ident.test(k)) throw new Error('bad column');
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    if (op === 'eq') { params.push(val); where.push(`${k}::text = $${start + params.length - 1}`); }
    else if (op === 'in') { params.push(val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''))); where.push(`${k}::text = any($${start + params.length - 1})`); }
    else if (op === 'is' && val === 'null') where.push(`${k} is null`);
    else throw new Error('unsupported filter ' + op);
  }
  return { sql: (where.length ? ' where ' + where.join(' and ') : '') + order + limit, params };
}

const server = http.createServer(async (req, res) => {
  const send = (code: number, body?: unknown) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  if (req.method === 'OPTIONS') return send(204);
  const url = new URL(req.url!, 'http://x');
  let raw = ''; for await (const ch of req) raw += ch;
  const body = raw ? JSON.parse(raw) : {};
  const sub = subOf(req.headers.authorization);
  try {
    const p = url.pathname;
    if (p === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type');
      const { rows } = grant === 'password'
        ? body.password === DEV_PASSWORD ? await pool.query(`select * from auth.users where email = $1`, [body.email]) : { rows: [] }
        : await pool.query(`select * from auth.users where id::text = $1`, [String(body.refresh_token ?? '').replace('dev-', '')]);
      return rows[0] ? send(200, session(rows[0])) : send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
    }
    if (p === '/auth/v1/signup') {
      if (body.password !== DEV_PASSWORD) return send(422, { msg: 'dev gateway: use the shared development password' });
      const { rows } = await pool.query(`insert into auth.users(email, raw_user_meta_data) values ($1, $2) returning *`, [body.email, body.data ?? {}]);
      return send(200, session(rows[0]));
    }
    if (p === '/auth/v1/user') { const { rows } = await pool.query(`select * from auth.users where id::text = $1`, [sub ?? '']); return rows[0] ? send(200, session(rows[0]).user) : send(401, { msg: 'no session' }); }
    if (p === '/auth/v1/logout') return send(204);

    const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(p);
    if (rpc) {
      const fn = rpc[1]!;
      const meta = (await pool.query(`select p.proretset, p.prorettype::regtype::text as ret, p.proargnames, (select array_agg(t::regtype::text) from unnest(p.proargtypes) t) as argtypes
                                      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`, [fn])).rows[0];
      if (!meta) return send(404, { message: 'function not found' });
      const names = Object.keys(body);
      const args = names.map((n) => { const i = (meta.proargnames ?? []).indexOf(n); const t = meta.argtypes?.[i]; return /^jsonb?$/.test(t ?? '') ? JSON.stringify(body[n]) : body[n]; });
      if (!names.every((n) => ident.test(n))) throw new Error('bad argument');
      const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
      const rows = (await asUser(sub, (q) => q(meta.proretset ? `select * from ${call}` : `select ${call} as r`, args))).rows;
      return send(200, meta.proretset ? rows : meta.ret === 'void' ? null : rows[0].r);
    }
    const tbl = /^\/rest\/v1\/([a-z_]+)$/.exec(p);
    if (tbl) {
      const t = tbl[1]!;
      if (req.method === 'GET') { const f = filters(url); return send(200, (await asUser(sub, (q) => q(`select * from public.${t}${f.sql}`, f.params))).rows); }
      if (req.method === 'PATCH') {
        const cols = Object.keys(body); if (!cols.every((c) => ident.test(c))) throw new Error('bad column');
        const f = filters(url, cols.length + 1);
        const rows = (await asUser(sub, (q) => q(`update public.${t} set ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}${f.sql} returning *`, [...cols.map((c) => body[c]), ...f.params]))).rows;
        return send(200, rows);
      }
    }
    send(404, { message: 'dev gateway: not implemented ' + req.method + ' ' + p });
  } catch (e: any) {
    send(400, { message: e.message, code: e.code ?? 'P0001', details: null, hint: null });
  }
});
server.listen(+(env.PORT ?? 54321), () => console.log('lamma dev gateway on http://localhost:' + (env.PORT ?? 54321)));
