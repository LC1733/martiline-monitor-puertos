# Martiline Monitor Puertos

Panel interno de Martiline con la programación de naves de **STI San Antonio** y **Puerto Valparaíso (TPS / TPV)**, y la **condición de oleaje y viento** frente a ambos puertos.

**Ver el panel:** https://lc1733.github.io/martiline-monitor-puertos/

Accesos directos: `#san-antonio` · `#valparaiso` · `#condicion`

## Cómo se actualiza

| Fuente | Frecuencia | Cómo |
|---|---|---|
| STI San Antonio | Diario 14:40 y 16:40 (hora de verano de Chile) | Automático (GitHub Actions lee la página pública de STI) |
| Puerto Valparaíso | Cada vez que se sube el PDF | Manual: el equipo sube el PDF del día |
| Condición de puertos | Cada 3 horas | Automático (pronóstico Open-Meteo) |

## Subir la planificación de Valparaíso (30 segundos)

1. Descarga el PDF desde https://www.puertovalparaiso.cl/planificacion_naviera (botón **Planificación PDF**).
2. Abre https://github.com/LC1733/martiline-monitor-puertos/upload/main/valparaiso
3. Arrastra el archivo **con el nombre `planificacion.pdf`** (reemplaza el anterior) y presiona **Commit changes**.
4. En 1 a 2 minutos el panel muestra la nueva planificación.

## Notas

- Datos obtenidos de información pública de cada terminal; los horarios pueden cambiar sin aviso. Confirmar con la naviera o el terminal antes de comprometer plazos con clientes.
- La condición oficial de puerto la determina la Capitanía de Puerto (Autoridad Marítima). Los niveles de oleaje y viento son referenciales.
- No se capturan los nombres ni teléfonos de superintendentes que publica STI.
- Open-Meteo es gratuito solo para uso no comercial. Para uso comercial, contratar una clave y guardarla como secreto `OPEN_METEO_KEY` en *Settings → Secrets and variables → Actions*.
