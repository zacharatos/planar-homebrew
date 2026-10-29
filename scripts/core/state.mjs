import {fail} from '../i18n.mjs';
export const TRANSITIONS = Object.freeze({
  unbound: ['dismissed'],
  dismissed: ['manifested'],
  manifested: ['dormant','dismissed','destroyed'],
  dormant: ['manifested','dismissed','destroyed'],
  destroyed: ['manifested']
});
export function transition(from,to) {
  if (!TRANSITIONS[from]?.includes(to)) throw fail('Err.Transition',{from,to});
  return to;
}
export function normalizedState(s) { return Object.hasOwn(TRANSITIONS,s) ? s : 'unbound'; }
