/**
 * Compile nested effect programs to a flat op list with jumps, so a frame's
 * position is one integer (`pc`) that serialises with the state.
 *
 *   if      → JIF(cond, else) ...then... JMP(end) ...else...
 *   repeat  → SET(counter, n) LOOP: JZ(counter, end) ...body... DEC(counter) JMP(LOOP)
 *   may     → ASK(yes/no) JNO(end) ...body...
 */
import type { Cond, Expr, Program, Step } from './dsl.js';

export type Op =
  | { o: 'step'; s: Step }
  | { o: 'jif'; cond: Cond; to: number } // jump if cond is FALSE
  | { o: 'jmp'; to: number }
  | { o: 'set'; v: string; value: Expr }
  | { o: 'jz'; v: string; to: number } // jump if var <= 0
  | { o: 'dec'; v: string }
  | { o: 'ask'; as: string; prompt: string }
  | { o: 'jfalse'; v: string; to: number }
  /** Attack damage placeholder: resolves the attack's (possibly scripted) base damage. */
  | { o: 'attackDamage' }
  | { o: 'confusion' };

let loopIds = 0;

/**
 * Compile a program. `base` is where the ops will sit in the final array, so
 * jump targets are absolute — concatenate compiled pieces only via `base`.
 */
export function compile(program: Program, base = 0): Op[] {
  const out: Op[] = [];
  emit(program, out);
  if (!base) return out;
  return out.map((op) => ('to' in op ? { ...op, to: op.to + base } : op));
}

function emit(program: Program, out: Op[]): void {
  for (const s of program) {
    switch (s.op) {
      case 'if': {
        const jif: { o: 'jif'; cond: Cond; to: number } = { o: 'jif', cond: s.cond, to: -1 };
        out.push(jif);
        emit(s.then, out);
        if (s.else && s.else.length) {
          const jmp: { o: 'jmp'; to: number } = { o: 'jmp', to: -1 };
          out.push(jmp);
          jif.to = out.length;
          emit(s.else, out);
          jmp.to = out.length;
        } else {
          jif.to = out.length;
        }
        break;
      }
      case 'repeat': {
        const v = `__loop${loopIds++}`;
        out.push({ o: 'set', v, value: s.n });
        const top = out.length;
        const jz: { o: 'jz'; v: string; to: number } = { o: 'jz', v, to: -1 };
        out.push(jz);
        emit(s.body, out);
        out.push({ o: 'dec', v });
        out.push({ o: 'jmp', to: top });
        jz.to = out.length;
        break;
      }
      case 'may': {
        const v = `__may${loopIds++}`;
        out.push({ o: 'ask', as: v, prompt: s.prompt ?? 'Use this effect?' });
        const jf: { o: 'jfalse'; v: string; to: number } = { o: 'jfalse', v, to: -1 };
        out.push(jf);
        emit(s.body, out);
        jf.to = out.length;
        break;
      }
      case 'set':
        out.push({ o: 'set', v: s.v, value: s.value });
        break;
      default:
        out.push({ o: 'step', s });
    }
  }
}
