// Lee la Programación de Faenas pública de STI San Antonio y genera data/sti.json.
// No captura los nombres ni teléfonos de superintendentes publicados por STI.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isoChile, nowChile, MESES, anioCercano, sinAcentos } from './tz.mjs';

const URL_STI = 'https://www.stiport.com/sti_en_linea/programacion_naves/index.php';
const OUT = 'data/sti.json';

const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ' };
const texto = (h) => h.replace(/<[^>]*>/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&([a-zA-Z]+);/g, (m, n) => (n in ENT ? ENT[n] : m))
  .replace(/\s+/g, ' ').trim();
const etiqueta = (s) => sinAcentos(s).toUpperCase().replace(/\s+/g, ' ').trim();
const vacio = (s) => !s || s === '-' || s === '–';

export function numero(v) {
  if (vacio(v)) return 0;
  const m = String(v).replace(/'/g, ' ').match(/\d[\d.]*/);
  return m ? parseInt(m[0].replace(/\./g, ''), 10) : 0;
}

export function fecha(v, pubY, pubM) {
  if (vacio(v)) return null;
  const s = String(v).replace(/'/g, ' ').replace(/\s+/g, ' ').trim();
  let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);
  if (m) return isoChile(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1], +m[4], +m[5]);
  m = s.match(/(\d{1,2})\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}):(\d{2})/);
  if (m && MESES[m[2].toUpperCase()]) {
    const mes = MESES[m[2].toUpperCase()];
    return isoChile(anioCercano(mes, pubY, pubM), mes, +m[1], +m[3], +m[4]);
  }
  return null;
}

// Filas de todo el documento, tolerando tablas anidadas y celdas sin cierre.
function filasDe(html) {
  return html.split(/<tr\b[^>]*>/i).slice(1).map((chunk) => {
    const fila = chunk.split(/<\/tr\s*>/i)[0];
    return fila.split(/<t[dh]\b[^>]*>/i).slice(1).map((c) => texto(c.split(/<\/t[dh]\s*>/i)[0]));
  }).filter((r) => r.length && r.some((c) => c));
}

export function parsear(html) {
  const todas = filasDe(html);
  const iS = todas.findIndex((r) => /^SITIO\b/.test(etiqueta(r[0] || '')));
  if (iS < 1) throw new Error('No se encontró la fila SITIO');
  // Bloque de la tabla: desde 2 filas antes de SITIO hasta la última fila con etiqueta conocida
  const filas = todas.slice(Math.max(0, iS - 3));

  const todo = filas.flat().join(' | ');
  const mp = todo.match(/(\d{1,2})\s+(?:de\s+)?([A-Za-zÁÉÍÓÚáéíóúñ]+)\s+(?:de\s+)?(\d{4})/);
  const pubD = mp ? +mp[1] : null;
  const pubM = mp ? MESES[sinAcentos(mp[2]).slice(0, 3).toUpperCase()] : null;
  const pubY = mp ? +mp[3] : new Date().getFullYear();
  const publicacion = (filas.flat().find((c) => /(lunes|martes|mi.rcoles|jueves|viernes|s.bado|domingo)/i.test(c) && /\d{4}/.test(c)) || '').trim();
  const md = todo.match(/OBSERVADO:\s*([\d.,]+)/i);
  const dolar = md ? parseFloat(md[1].replace(',', '.')) : null;

  const iSitio = filas.findIndex((r) => /^SITIO\b/.test(etiqueta(r[0] || '')));
  const nombres = filas[iSitio - 1];
  const cols = nombres.map((c, i) => i).filter((i) => i > 0 && !vacio(nombres[i]));
  const naves = cols.map((i) => ({
    puerto: 'San Antonio', terminal: 'STI', sitio: '', nave: nombres[i].toUpperCase(),
    eta: null, atraque: null, inicio: null, termino: null,
    descarga: { total: 0, reefer: 0, mty: 0, imo: 0 }, embarque: { total: 0, reefer: 0, mty: 0, imo: 0 },
  }));

  let sec = null;
  for (const r of filas.slice(iSitio)) {
    const e = etiqueta(r[0] || '');
    if (e === 'SUPERINTENDENTE') continue; // datos personales: no se capturan
    if (e === 'DESCARGA') sec = 'descarga';
    if (e === 'EMBARQUE') sec = 'embarque';
    naves.forEach((n, k) => {
      const v = r[cols[k]] || '';
      if (e === 'SITIO') n.sitio = (v.match(/\d+/) || [''])[0];
      else if (e.startsWith('ETA')) n.eta = fecha(v, pubY, pubM);
      else if (e === 'HORA DE ATRAQUE') n.atraque = fecha(v, pubY, pubM);
      else if (e === 'INICIO DE FAENAS') n.inicio = fecha(v, pubY, pubM);
      else if (e === 'TERMINO DE FAENAS') n.termino = fecha(v, pubY, pubM);
      else if ((e === 'DESCARGA' || e === 'EMBARQUE') && sec) n[sec].total = numero(v);
      else if (e === 'REEFERS FULL' && sec) n[sec].reefer = numero(v);
      else if (e === 'MTY' && sec) n[sec].mty = numero(v);
      else if (e === 'IMO' && sec) n[sec].imo = numero(v);
    });
  }
  const ok = naves.filter((n) => n.eta);
  ok.forEach((n) => { n.atraque ||= n.eta; n.inicio ||= n.atraque; n.termino ||= n.inicio; });
  if (!ok.length) throw new Error('La tabla no trae naves con ETA');
  return { publicacion, publicacion_fecha: pubD ? isoChile(pubY, pubM, pubD) : null, dolar, naves: ok };
}

async function main() {
  const r = await fetch(URL_STI, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MartilineMonitorPuertos/1.0; +https://github.com/LC1733/martiline-monitor-puertos)' } });
  if (!r.ok) throw new Error('STI respondió HTTP ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  let html = new TextDecoder('utf-8').decode(buf);
  if (html.includes('�')) html = new TextDecoder('latin1').decode(buf);
  fs.writeFileSync('/tmp/sti.html', html);
  const d = parsear(html);
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generado: nowChile(), fuente: URL_STI, ...d }, null, 1));
  console.log(`STI: ${d.publicacion} · ${d.naves.length} naves`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e.message); process.exit(1); });
