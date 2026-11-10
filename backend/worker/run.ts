// Entry point for the scheduled job:  DATABASE_URL=... PLAN_START_LEAD_MIN=... npm run worker:plan
import { Client } from 'pg';
import { distanceFromEnv, runPlanning } from './plan';

async function main() {
  const url = process.env.DATABASE_URL;
  const lead = Number(process.env.PLAN_START_LEAD_MIN);
  if (!url) throw new Error('DATABASE_URL is required (server-side secret; never ship it in the app)');
  if (!Number.isFinite(lead)) throw new Error('PLAN_START_LEAD_MIN is required');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
    await c.query('set role service_role');
    const report = await runPlanning(async (t, p) => (await c.query(t, p as any[])).rows, { startLeadMin: lead, distance: distanceFromEnv(process.env) });
    console.log(JSON.stringify(report));
  } finally { await c.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
