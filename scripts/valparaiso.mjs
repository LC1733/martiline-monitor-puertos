// Lee el PDF "Planificación Naviera" de Puerto Valparaíso (carpeta valparaiso/) y genera data/valparaiso.json.
// El PDF lo descarga una persona del equipo desde la página pública de EPV y lo sube al repositorio.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { isoChile, nowChile, MESES, anioCercano } from './tz.mjs';

const DIR = 'valparaiso';
const OUT = 'data/valparaiso.json';
const esHora = (s) => /^\d{1,2}:\d{2}$/.test(s);
const fechaDMY = (s) => {
  const m = String(s).match(/(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})/);
  return m ? isoChile(+m[3], +m[2], +m[1], +m[4], +m[5]) : null;
};
const num = (s) => (s && /\d/.test(s) ? parseInt(String(s).replace(/\./g, ''), 10) : 0);
// [Inferencia] Sitios 1-5 = TPS (Terminal 1); sitios 6-8 = TPV (Terminal 2), según la asignación del PDF.
const terminalDeSitio = (n) => (n <= 5 ? 'TPS' : 'TPV');
const terminalDeTexto = (t) => (/1/.test(t) ? 'TPS' : /2/.test(t) ? 'TPV' : '');

async function paginas(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.filter((it) => it.str.trim()).map((it) => ({ x: it.transform[4], y: it.transform[5], s: it.str.trim() })));
  }
  return out;
}

function filas(items) {
  const g = new Map();
  for (const it of items) {
    const k = [...g.keys()].find((y) => Math.abs(y - it.y) < 2.5) ?? it.y;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(it);
  }
  return [...g.entries()].sort((a, b) => b[0] - a[0]).map(([y, it]) => ({ y, it: it.sort((a, b) => a.x - b.x) }));
}

function grilla(items, pubY, pubM) {
  const cab = items.filter((i) => /^Sitio\s*\d+$/i.test(i.s)).map((i) => {
    const n = +i.s.match(/\d+/)[0];
    return { n, left: i.x - 34, right: i.x + 52, center: i.x + 11, y: i.y };
  });
  if (!cab.length) throw new Error('No se encontró la grilla de sitios en la página 1');
  const yCab = Math.min(...cab.map((c) => c.y));
  const dias = items.filter((i) => i.x < 60 && /^\d{1,2}\s+[A-Za-z]{3}$/.test(i.s)).map((i) => {
    const [d, mon] = i.s.split(/\s+/);
    const mes = MESES[mon.toUpperCase()];
    return { y: i.y, y4: anioCercano(mes, pubY, pubM), mes, d: +d };
  }).sort((a, b) => b.y - a.y);
  const diaDe = (y) => dias.reduce((best, d) => (Math.abs(d.y - y) < Math.abs(best.y - y) ? d : best), dias[0]);
  const cuerpo = items.filter((i) => i.y < yCab - 5 && i.x >= 60);

  const visitas = [];
  for (const c of cab) {
    const en = cuerpo.filter((i) => i.x >= c.left && i.x < c.right).sort((a, b) => b.y - a.y);
    const nombres = en.filter((i) => !esHora(i.s) && !/^LOA\b/i.test(i.s));
    const loas = en.filter((i) => /^LOA\b/i.test(i.s));
    const horas = en.filter((i) => esHora(i.s));
    const occ = nombres.map((n) => ({ ...n, ini: null, fin: null, loa: loas.find((l) => l.y < n.y && n.y - l.y < 10)?.s || '' }));
    for (const h of horas) {
      const inicio = h.x < c.center;
      const cand = occ.filter((o) => (inicio ? o.y < h.y : o.y > h.y)).sort((a, b) => Math.abs(a.y - h.y) - Math.abs(b.y - h.y))[0];
      if (!cand) continue;
      const d = diaDe(h.y), [hh, mm] = h.s.split(':').map(Number);
      cand[inicio ? 'ini' : 'fin'] = isoChile(d.y4, d.mes, d.d, hh, mm);
    }
    // Agrupar apariciones consecutivas de la misma nave en el sitio = una estadía
    for (const o of occ) {
      const prev = visitas[visitas.length - 1];
      if (prev && prev.sitio === c.n && prev.nave === o.s.toUpperCase() && !prev.cerrada) {
        prev.fin = o.fin || prev.fin; prev.loa ||= o.loa;
        if (o.fin) prev.cerrada = true;
      } else {
        const d = diaDe(o.y);
        visitas.push({ sitio: c.n, nave: o.s.toUpperCase(), ini: o.ini, fin: o.fin, loa: o.loa, cerrada: !!o.fin,
          iniVentana: isoChile(d.y4, d.mes, d.d, 0, 0) });
      }
    }
  }
  const desde = dias.length ? isoChile(dias[0].y4, dias[0].mes, dias[0].d) : null;
  const u = dias[dias.length - 1];
  const hasta = u ? isoChile(u.y4, u.mes, u.d, 23, 59) : null;
  return { visitas, desde, hasta };
}

function tablaAnuncios(pags) {
  let cols = null; const out = []; const gira = [];
  for (const items of pags.slice(1)) {
    let modoGira = false;
    for (const f of filas(items)) {
      const t = f.it.map((i) => i.s).join(' ');
      if (/NAVES A LA GIRA/i.test(t)) { modoGira = true; continue; }
      if (/^ANUNCIOS/i.test(t)) continue;
      if (/^Nave\b/.test(f.it[0].s)) { if (!modoGira) cols = f.it.map((i) => ({ h: i.s, x: i.x })); continue; }
      if (modoGira) {
        const fechaTxt = f.it.find((i) => /\d{2}-\d{2}-\d{4}/.test(i.s));
        if (fechaTxt) gira.push({ nave: f.it[0].s.toUpperCase(), agencia: f.it[1] && f.it[1] !== fechaTxt ? f.it[1].s : '', anuncio: fechaDMY(fechaTxt.s) });
        continue;
      }
      if (!cols) continue;
      const fila = {};
      for (const it of f.it) {
        const c = cols.filter((c) => c.x - 22 <= it.x).pop() || cols[0];
        fila[c.h] = fila[c.h] ? fila[c.h] + ' ' + it.s : it.s;
      }
      if (!fila['Anuncio'] || !/\d{2}-\d{2}-\d{4}/.test(fila['Anuncio'])) continue;
      out.push({
        nave: (fila['Nave'] || '').toUpperCase(), agencia: fila['Agencia'] || '', terminal: terminalDeTexto(fila['Terminal'] || ''),
        anuncio: fechaDMY(fila['Anuncio']), pideSitio: fechaDMY(fila['Pide Sitio'] || ''),
        carga: { ton_impo: num(fila['Ton.Impo']), ton_expo: num(fila['Ton.Expo']), cnt_impo: num(fila['Cnt.Impo']), cnt_expo: num(fila['Cnt.Expo']), vehiculos: num(fila['Vehic.']), pallets: num(fila['Pallets']) },
      });
    }
  }
  const vistos = new Set();
  return { anuncios: out.filter((a) => { const k = JSON.stringify(a); if (vistos.has(k)) return false; vistos.add(k); return true; }), gira };
}

export async function procesar(file) {
  const pags = await paginas(file);
  const cab = pags[0].map((i) => i.s).join(' ').match(/Publicaci[oó]n:\s*(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!cab) throw new Error('No se encontró la "Fecha Publicación" en el PDF');
  const [pubD, pubM, pubY] = [+cab[1], +cab[2], +cab[3]];
  const g = grilla(pags[0], pubY, pubM);
  const { anuncios, gira } = tablaAnuncios(pags);
  const porNave = (n) => anuncios.find((a) => a.nave === n);

  const naves = g.visitas.map((v) => {
    const a = porNave(v.nave) || {};
    return { puerto: 'Valparaíso', terminal: terminalDeSitio(v.sitio), sitio: String(v.sitio), nave: v.nave, tipo: 'atraque',
      agencia: a.agencia || '', loa: v.loa, eta: a.anuncio || v.ini || null,
      atraque: v.ini || v.iniVentana, inicio: v.ini || v.iniVentana, termino: v.fin,
      atracadaAntes: !v.ini, carga: a.carga || null };
  });
  const enGrilla = new Set(naves.map((n) => n.nave));
  for (const a of anuncios) {
    if (enGrilla.has(a.nave)) continue;
    naves.push({ puerto: 'Valparaíso', terminal: a.terminal, sitio: '', nave: a.nave, tipo: 'anuncio', agencia: a.agencia, loa: '',
      eta: a.anuncio, atraque: a.pideSitio || a.anuncio, inicio: null, termino: null, carga: a.carga });
  }
  for (const gi of gira) {
    naves.push({ puerto: 'Valparaíso', terminal: '', sitio: '', nave: gi.nave, tipo: 'gira', agencia: gi.agencia, loa: '',
      eta: gi.anuncio, atraque: null, inicio: null, termino: null, carga: null });
  }
  return { publicacion: `${String(pubD).padStart(2, '0')}-${String(pubM).padStart(2, '0')}-${pubY} ${cab[4]}:${cab[5]}`,
    publicacion_fecha: isoChile(pubY, pubM, pubD, +cab[4], +cab[5]), ventana: { desde: g.desde, hasta: g.hasta }, naves };
}

async function main() {
  const pdfs = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.pdf')) : [];
  if (!pdfs.length) throw new Error('No hay PDF en la carpeta valparaiso/');
  const res = [];
  for (const f of pdfs) {
    try { res.push(await procesar(path.join(DIR, f))); } catch (e) { console.error(`${f}: ${e.message}`); }
  }
  if (!res.length) throw new Error('Ningún PDF se pudo leer');
  const d = res.sort((a, b) => Date.parse(b.publicacion_fecha) - Date.parse(a.publicacion_fecha))[0];
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generado: nowChile(), fuente: 'https://www.puertovalparaiso.cl/planificacion_naviera', ...d }, null, 1));
  console.log(`Valparaíso: publicación ${d.publicacion} · ${d.naves.length} naves`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e.message); process.exit(1); });
