// Vigilancia de salud del Monitor de Puertos Martiline.
// Revisa que cada fuente esté al día, que los datos tengan sentido, que los workflows no estén fallando
// o desactivados y que el panel publicado responda. Si algo deja de funcionar —por la causa que sea—
// abre (o actualiza) un issue "Alerta de funcionamiento" que notifica por correo al dueño del repositorio,
// y lo cierra solo cuando todo vuelve a la normalidad.
import fs from 'node:fs';
import { nowChile } from './tz.mjs';

const REPO = process.env.GITHUB_REPOSITORY || 'LC1733/martiline-monitor-puertos';
const TOKEN = process.env.GITHUB_TOKEN || '';
const AVISAR_A = '@LC1733';
const PANEL = 'https://lc1733.github.io/martiline-monitor-puertos/';
const TITULO = '⚠️ Monitor de Puertos — alerta de funcionamiento';
const HORA = 36e5, DIA = 24 * HORA;
const ahora = Date.now();

const problemas = []; // { clave, nivel: 'falla'|'aviso', texto }
const ok = [];
const falla = (clave, texto) => problemas.push({ clave, nivel: 'falla', texto });
const aviso = (clave, texto) => problemas.push({ clave, nivel: 'aviso', texto });
const hace = (iso) => { const h = (ahora - Date.parse(iso)) / HORA; return h < 48 ? `hace ${h.toFixed(1)} h` : `hace ${(h / 24).toFixed(1)} días`; };

function leer(ruta) {
  try { return JSON.parse(fs.readFileSync(ruta, 'utf8')); }
  catch (e) { falla(`lectura:${ruta}`, `No se pudo leer \`${ruta}\` (${e.message}).`); return null; }
}

async function gh(path, opciones = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opciones.headers || {}) },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`GitHub API ${r.status} en ${path}`);
  return r.status === 204 ? null : r.json();
}

// ---------- 1. Datos: frescura y contenido ----------
function revisarDatos() {
  const c = leer('data/condicion.json');
  if (c) {
    const edad = ahora - Date.parse(c.generado);
    if (!(edad < 7 * HORA)) falla('condicion:vieja', `**Condición de puertos** sin actualizar desde ${c.generado} (${hace(c.generado)}). Debería renovarse cada 3 horas.`);
    else ok.push(`Condición de puertos al día (${hace(c.generado)}).`);
    const puertos = c.puertos || [];
    if (puertos.length !== 2) falla('condicion:puertos', `**Condición de puertos**: se esperaban 2 puertos y hay ${puertos.length}.`);
    for (const p of puertos) {
      const horas = p.horas || [];
      const conOla = horas.filter((h) => h.ola != null).length;
      const conViento = horas.filter((h) => h.viento != null).length;
      if (horas.length < 24) falla(`condicion:horas:${p.puerto}`, `**Condición ${p.puerto}**: solo ${horas.length} horas de pronóstico (se esperan ~72).`);
      else if (conOla < horas.length / 2 || conViento < horas.length / 2) falla(`condicion:vacios:${p.puerto}`, `**Condición ${p.puerto}**: el pronóstico viene mayormente vacío (oleaje ${conOla}/${horas.length}, viento ${conViento}/${horas.length}).`);
    }
  }

  const s = leer('data/sti.json');
  if (s) {
    if (!(ahora - Date.parse(s.generado) < 30 * HORA)) falla('sti:captura', `**STI San Antonio**: la captura automática no corre desde ${s.generado} (${hace(s.generado)}). Debería correr a diario 14:40 y 16:40.`);
    const pub = s.publicacion_fecha || s.generado;
    if (!(ahora - Date.parse(pub) < 2.5 * DIA)) aviso('sti:publicacion', `**STI San Antonio**: la última programación publicada es del ${s.publicacion} (${hace(pub)}). Puede que STI no haya publicado o que haya cambiado su página.`);
    if (!(s.naves || []).length) aviso('sti:vacio', '**STI San Antonio**: la captura no trae naves. Revisar si STI cambió el formato de su página.');
    if (!problemas.some((x) => x.clave.startsWith('sti:'))) ok.push(`STI al día (publicación ${s.publicacion}, ${(s.naves || []).length} naves).`);
  }

  const v = leer('data/valparaiso.json');
  if (v) {
    const vencida = v.ventana?.hasta && Date.parse(v.ventana.hasta) < ahora;
    if (vencida) falla('valpo:vencida', `**Puerto Valparaíso**: la planificación cargada (publicada ${v.publicacion}) ya venció el ${v.ventana.hasta}. El panel no tiene naves vigentes: hay que subir el PDF del día.`);
    else if (!(ahora - Date.parse(v.publicacion_fecha) < 2 * DIA)) aviso('valpo:vieja', `**Puerto Valparaíso**: la planificación es del ${v.publicacion} (${hace(v.publicacion_fecha)}). Falta subir el PDF del día a la carpeta \`valparaiso\` (tarea manual del equipo).`);
    if (!(v.naves || []).length) falla('valpo:vacio', '**Puerto Valparaíso**: el PDF se leyó pero no trajo naves. Revisar si EPV cambió el formato.');
    if (!problemas.some((x) => x.clave.startsWith('valpo:'))) ok.push(`Valparaíso al día (publicación ${v.publicacion}).`);
  }
}

// ---------- 2. Workflows: fallas y desactivación ----------
async function revisarWorkflows() {
  const { workflows } = await gh(`/repos/${REPO}/actions/workflows?per_page=50`);
  for (const w of workflows) {
    if (!w.path.startsWith('.github/workflows/') || w.path.endsWith('salud.yml')) continue;
    if (w.state !== 'active') { falla(`wf:estado:${w.name}`, `El workflow **${w.name}** está *${w.state}* (GitHub lo desactivó o se apagó a mano). No se va a ejecutar hasta reactivarlo en Actions.`); continue; }
    const { workflow_runs: runs } = await gh(`/repos/${REPO}/actions/workflows/${w.id}/runs?per_page=1&status=completed&branch=main`);
    const r = runs[0];
    if (!r) continue;
    if (!['success', 'skipped', 'cancelled'].includes(r.conclusion)) falla(`wf:run:${w.name}`, `La última ejecución de **${w.name}** terminó en *${r.conclusion}* (${hace(r.updated_at)}): ${r.html_url}`);
  }
}

// ---------- 3. Panel publicado ----------
async function revisarPanel() {
  try {
    const b = await gh(`/repos/${REPO}/pages/builds/latest`);
    if (b.status === 'errored') falla('pages:build', `La última publicación de GitHub Pages falló: ${b.error?.message || 'sin detalle'}.`);
  } catch (e) { aviso('pages:api', `No se pudo consultar el estado de GitHub Pages (${e.message}).`); }
  try {
    const r = await fetch(PANEL, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) falla('panel:http', `El panel ${PANEL} responde HTTP ${r.status}.`);
    else ok.push('Panel publicado responde.');
  } catch (e) { falla('panel:red', `El panel ${PANEL} no responde (${e.cause?.code || e.message}).`); }
}

// ---------- 4. Issue de alerta ----------
async function notificar() {
  const huella = problemas.map((p) => p.clave).sort().join('|');
  const abiertos = await gh(`/repos/${REPO}/issues?state=open&per_page=100`);
  const issue = abiertos.find((i) => i.title === TITULO && !i.pull_request);
  const lista = (n) => problemas.filter((p) => p.nivel === n).map((p) => `- ${p.texto}`).join('\n');
  const cuerpo = [
    `${AVISAR_A} el vigilante automático detectó que algo del Monitor de Puertos dejó de funcionar.`,
    '',
    problemas.some((p) => p.nivel === 'falla') ? `### 🔴 Fallas\n${lista('falla')}\n` : '',
    problemas.some((p) => p.nivel === 'aviso') ? `### 🟡 Avisos\n${lista('aviso')}\n` : '',
    ok.length ? `### 🟢 Funcionando\n${ok.map((x) => `- ${x}`).join('\n')}\n` : '',
    `Última revisión: ${nowChile()} (hora de Chile). Este issue se actualiza cada hora y **se cierra solo** cuando todo vuelve a la normalidad.`,
    `Panel: ${PANEL}`,
    `<!-- huella:${huella} -->`,
  ].filter(Boolean).join('\n');

  if (problemas.length) {
    if (!issue) {
      const nuevo = await gh(`/repos/${REPO}/issues`, { method: 'POST', body: JSON.stringify({ title: TITULO, body: cuerpo }) });
      console.log('Issue de alerta creado:', nuevo.html_url);
    } else {
      const anterior = (issue.body || '').match(/<!-- huella:(.*?) -->/)?.[1] ?? '';
      await gh(`/repos/${REPO}/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ body: cuerpo }) });
      if (anterior !== huella) {
        await gh(`/repos/${REPO}/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `${AVISAR_A} cambió el estado de las alertas:\n\n${lista('falla')}\n${lista('aviso')}` }) });
        console.log('Estado de alertas cambió; se comentó en', issue.html_url);
      } else console.log('Alertas sin cambios; issue actualizado sin notificar:', issue.html_url);
    }
  } else if (issue) {
    await gh(`/repos/${REPO}/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `✅ ${AVISAR_A} todo volvió a la normalidad (${nowChile()}).\n\n${ok.map((x) => `- ${x}`).join('\n')}` }) });
    await gh(`/repos/${REPO}/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
    console.log('Todo normal; issue cerrado.');
  }
}

async function main() {
  revisarDatos();
  try { await revisarWorkflows(); } catch (e) { aviso('wf:api', `No se pudo revisar el estado de los workflows (${e.message}).`); }
  await revisarPanel();

  const resumen = [`## Salud del Monitor de Puertos — ${nowChile()}`, '',
    ...problemas.map((p) => `- ${p.nivel === 'falla' ? '🔴' : '🟡'} ${p.texto}`), ...ok.map((x) => `- 🟢 ${x}`)].join('\n');
  console.log(resumen);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, resumen + '\n');

  if (TOKEN) await notificar();
  else console.log('(Sin GITHUB_TOKEN: solo diagnóstico, sin issue.)');
}
main().catch((e) => { console.error('El vigilante falló:', e.message); process.exit(1); });
