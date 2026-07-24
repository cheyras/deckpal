import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { loadEnv, makePool } from '@pokedex/db';

// Phase 2 · task 1 skeleton. REST routes land in later tasks; this proves the process
// boots, binds localhost-only (nginx is the sole ingress), and reaches the DB within budget.
loadEnv();

// Connection budget: the API gets 2 of the 3 total. See DECISIONS.md / DATA-LAYER §6.5.
const pool = makePool(Number(process.env.PGPOOL_MAX_API ?? 2));

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());

// The app serves from a sub-path behind nginx (/pokedex, /api/pokedex). Router basename TBD.
app.get('/api/pokedex/health', async (_req, res) => {
  try {
    const { rows } = await pool.query<{ now: string }>('SELECT now() AS now');
    res.json({ status: 'ok', db: 'up', now: rows[0]?.now });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'down', error: (err as Error).message });
  }
});

const port = Number(process.env.POKEDEX_API_PORT ?? 3700);
// Bind to loopback only — the app has no auth of its own; the SSO gate/nginx is the boundary.
app.listen(port, '127.0.0.1', () => {
  console.log(`pokedex-api listening on 127.0.0.1:${port}`);
});
