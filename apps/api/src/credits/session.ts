import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';
import { currentUserId } from '../identity.js';
import { rlsStore, withTx } from '../db.js';
import { ApiError } from '../http.js';
const actorStore = new AsyncLocalStorage<string>();
export const privateSession: RequestHandler = (req,res,next) => {
  res.setHeader('Cache-Control','private, no-store');
  if (!req.authKind || req.authKind==='token') return next(new ApiError(403,'session_required','Use an application session.'));
  actorStore.run(currentUserId(req),next);
};
export async function sessionCall<T=Record<string,unknown>>(sql:string,args:unknown[]=[]):Promise<T> {
  try {
    return await withTx(async client => {
      if (!rlsStore.getStore()) await client.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actorStore.getStore(),role:'local',deckpal_auth_kind:'local'})]);
      const row=(await client.query<{data:T}>(sql,args)).rows[0];
      if (!row) throw new Error('Missing database response');
      return row.data;
    });
  } catch(error) {
    const code=(error as {code?:string}).code;
    const status=code==='40001'?409:code==='22023'?400:code==='42501'?403:code==='P0002'?404:0;
    if(status) throw new ApiError(status,status===409?'conflict':status===403?'forbidden':'invalid_input',(error as Error).message);
    throw error;
  }
}
