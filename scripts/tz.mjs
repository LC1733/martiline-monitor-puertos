// Hora de Chile continental (America/Santiago), con cambio de horario automático.
const p = (n) => String(n).padStart(2, '0');

function offsetMin(ms) {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', timeZoneName: 'longOffset' })
    .formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName').value; // "GMT-03:00"
  const m = s.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
  if (!m) return 0;
  const v = +m[2] * 60 + +(m[3] || 0);
  return m[1] === '-' ? -v : v;
}

/** Fecha/hora local de Chile -> ISO 8601 con su offset real. */
export function isoChile(y, mo, d, h = 0, mi = 0) {
  const local = Date.UTC(y, mo - 1, d, h, mi);
  let off = offsetMin(local);
  off = offsetMin(local - off * 60000);
  const a = Math.abs(off);
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00${off < 0 ? '-' : '+'}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

/** Ahora, en hora de Chile, como ISO con offset. */
export function nowChile() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).reduce((o, x) => ((o[x.type] = x.value), o), {});
  return isoChile(+f.year, +f.month, +f.day, +f.hour, +f.minute);
}

export const MESES = { ENE: 1, JAN: 1, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, AUG: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12, DEC: 12 };

/** Año de un mes que aparece cerca de una fecha de referencia (cruce de año). */
export function anioCercano(mes, refY, refM) {
  if (refM >= 10 && mes <= 3) return refY + 1;
  if (refM <= 3 && mes >= 10) return refY - 1;
  return refY;
}

export const sinAcentos = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
