// Condición de oleaje y viento frente a Valparaíso y San Antonio (pronóstico Open-Meteo) -> data/condicion.json
// Nota de licencia: el API gratuito de Open-Meteo es para uso no comercial. Para uso comercial interno,
// contratar una clave en open-meteo.com y guardarla como secreto OPEN_METEO_KEY del repositorio.
import fs from 'node:fs';
import { isoChile, nowChile } from './tz.mjs';

const KEY = process.env.OPEN_METEO_KEY || '';
const PUERTOS = [
  { puerto: 'Valparaíso', lat: -33.02, lon: -71.64 },
  { puerto: 'San Antonio', lat: -33.58, lon: -71.65 },
];
const base = (tipo) => (KEY ? `https://customer-${tipo}.open-meteo.com` : `https://${tipo}.open-meteo.com`);
const q = (o) => new URLSearchParams({ ...o, timezone: 'America/Santiago', forecast_days: '3', ...(KEY ? { apikey: KEY } : {}) });

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url.split('?')[0]}`);
  return r.json();
}
const iso = (t) => { const m = t.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return isoChile(+m[1], +m[2], +m[3], +m[4], +m[5]); };
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

async function main() {
  const salida = [];
  for (const p of PUERTOS) {
    const mar = await json(`${base('marine-api')}/v1/marine?` + q({ latitude: p.lat, longitude: p.lon, hourly: 'wave_height,wave_direction,wave_period,swell_wave_height' }));
    const at = await json(`${base('api')}/v1/forecast?` + q({ latitude: p.lat, longitude: p.lon, hourly: 'wind_speed_10m,wind_gusts_10m,wind_direction_10m', wind_speed_unit: 'kn' }));
    const viento = new Map(at.hourly.time.map((t, i) => [t, i]));
    const horas = mar.hourly.time.map((t, i) => {
      const j = viento.get(t);
      return { t: iso(t), ola: r1(mar.hourly.wave_height[i]), periodo: r1(mar.hourly.wave_period[i]), dir_ola: mar.hourly.wave_direction[i],
        marejada: r1(mar.hourly.swell_wave_height[i]),
        viento: j == null ? null : r1(at.hourly.wind_speed_10m[j]), racha: j == null ? null : r1(at.hourly.wind_gusts_10m[j]),
        dir_viento: j == null ? null : at.hourly.wind_direction_10m[j] };
    });
    salida.push({ ...p, horas });
  }
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/condicion.json', JSON.stringify({ generado: nowChile(), fuente: 'Open-Meteo (pronóstico marino y de viento)', puertos: salida }));
  console.log('Condición actualizada:', salida.map((s) => `${s.puerto} ${s.horas.length} h`).join(', '));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
