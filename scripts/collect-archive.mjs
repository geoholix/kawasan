// Collect hourly air-quality snapshots into the static archive served by the app.
//
//   node scripts/collect-archive.mjs [pastDays]      (default 3, max 92)
//
// Sources, applied in order (later sources overwrite earlier ones for the same hour):
//   1. Open-Meteo / CAMS model, all stations                  (no key)
//   2. OpenAQ v3 measurements, stations of kind "embassy"      (needs OPENAQ_API_KEY; skipped otherwise)
//      OPENAQ_LOCATIONS='{"usemb-c":1234,"usemb-s":5678}' pins OpenAQ location ids;
//      otherwise the nearest location within 2 km that has a PM2.5 sensor is used.
//      Only values reported in ug/m3 are archived.
//
// Writes public/data/archive/YYYY-MM.json (UTC months, hourly arrays) and
// public/data/archive/index.json. Existing values are kept unless the new
// fetch returns a non-null value for the same hour. Run on a schedule by
// .github/workflows/collect-archive.yml.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "data", "archive");
const HOUR = 3_600_000;

const VARIABLES = {
  pm2_5: "pm2_5",
  pm10: "pm10",
  no2: "nitrogen_dioxide",
  o3: "ozone",
  so2: "sulphur_dioxide",
  co: "carbon_monoxide",
};

/** Station coordinates come from src/config/app.config.ts so there is a single source of truth. */
async function readStations() {
  const src = await readFile(join(root, "src", "config", "app.config.ts"), "utf8");
  const from = src.indexOf("stations: [");
  const block = src.slice(from, src.indexOf("weatherLocations", from));
  const re = /id:\s*"([^"]+)".*?kind:\s*"([^"]+)".*?latitude:\s*(-?[\d.]+),\s*longitude:\s*(-?[\d.]+)/g;
  const stations = [...block.matchAll(re)].map((m) => ({ id: m[1], kind: m[2], latitude: Number(m[3]), longitude: Number(m[4]) }));
  if (!stations.length) throw new Error("No stations found in app.config.ts");
  return stations;
}

const monthKey = (t) => new Date(t).toISOString().slice(0, 7);
const monthStart = (key) => Date.parse(`${key}-01T00:00:00Z`);
const hoursInMonth = (key) => {
  const s = monthStart(key);
  const d = new Date(s);
  return (Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - s) / HOUR;
};

async function loadMonth(key) {
  try {
    return JSON.parse(await readFile(join(outDir, `${key}.json`), "utf8"));
  } catch {
    return { month: key, start: monthStart(key), hours: hoursInMonth(key), stations: {} };
  }
}

async function fetchOpenMeteo(stations, pastDays) {
  const params = new URLSearchParams({
    latitude: stations.map((s) => s.latitude.toFixed(4)).join(","),
    longitude: stations.map((s) => s.longitude.toFixed(4)).join(","),
    hourly: Object.values(VARIABLES).join(","),
    timeformat: "unixtime",
    past_days: String(pastDays),
    forecast_days: "1",
  });
  const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status} ${res.statusText}`);
  const json = await res.json();
  return Array.isArray(json) ? json : [json];
}

// ---- OpenAQ v3 -----------------------------------------------------------

const OPENAQ = "https://api.openaq.org/v3";
const OPENAQ_PARAMETERS = { pm25: "pm2_5", pm10: "pm10", no2: "no2", o3: "o3", so2: "so2", co: "co" };

async function openaq(path, params, key) {
  const res = await fetch(`${OPENAQ}${path}?${new URLSearchParams(params)}`, { headers: { "X-API-Key": key } });
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 15_000)); // free tier: 60 requests/min
    return openaq(path, params, key);
  }
  if (!res.ok) throw new Error(`OpenAQ ${res.status} ${res.statusText} - ${path}`);
  return (await res.json()).results ?? [];
}

/** Resolve the OpenAQ sensors (id -> app pollutant) for one station. */
async function findSensors(station, key, pinned) {
  let location;
  if (pinned[station.id]) {
    [location] = await openaq(`/locations/${pinned[station.id]}`, {}, key);
  } else {
    const found = await openaq("/locations", { coordinates: `${station.latitude},${station.longitude}`, radius: "2000", limit: "20" }, key);
    location = found.find((l) => l.sensors?.some((s) => s.parameter?.name === "pm25"));
  }
  if (!location) return null;
  const sensors = (location.sensors ?? [])
    .filter((s) => OPENAQ_PARAMETERS[s.parameter?.name] && /g\/m/i.test(s.parameter?.units ?? ""))
    .map((s) => ({ id: s.id, pollutant: OPENAQ_PARAMETERS[s.parameter.name] }));
  return { name: location.name, id: location.id, sensors };
}

async function fetchOpenAq(stations, pastDays) {
  const key = process.env.OPENAQ_API_KEY;
  if (!key) {
    console.log("OPENAQ_API_KEY not set - skipping OpenAQ");
    return [];
  }
  const pinned = process.env.OPENAQ_LOCATIONS ? JSON.parse(process.env.OPENAQ_LOCATIONS) : {};
  const to = new Date();
  const from = new Date(to.getTime() - pastDays * 24 * HOUR);
  const records = []; // { station, pollutant, t, value }
  for (const station of stations.filter((s) => s.kind === "embassy")) {
    try {
      const match = await findSensors(station, key, pinned);
      if (!match?.sensors.length) {
        console.warn(`OpenAQ: no usable sensors for ${station.id}`);
        continue;
      }
      console.log(`OpenAQ: ${station.id} <- "${match.name}" (location ${match.id}), ${match.sensors.length} sensor(s)`);
      for (const sensor of match.sensors) {
        const rows = await openaq(
          `/sensors/${sensor.id}/hours`,
          {
            datetime_from: from.toISOString(),
            datetime_to: to.toISOString(),
            date_from: from.toISOString(),
            date_to: to.toISOString(),
            limit: "1000",
          },
          key,
        );
        for (const row of rows) {
          const t = Date.parse(row.period?.datetimeFrom?.utc ?? "");
          if (Number.isFinite(t) && typeof row.value === "number" && row.value >= 0) {
            records.push({ station: station.id, pollutant: sensor.pollutant, t, value: row.value });
          }
        }
      }
    } catch (e) {
      console.warn(`OpenAQ: ${station.id} failed - ${e.message}`);
    }
  }
  return records;
}

async function main() {
  const pastDays = Math.min(92, Math.max(1, Number(process.argv[2]) || 3));
  const stations = await readStations();
  const data = await fetchOpenMeteo(stations, pastDays);
  const cutoff = Math.floor(Date.now() / HOUR) * HOUR; // never archive forecast hours

  const months = new Map();
  let written = 0;
  for (let i = 0; i < stations.length; i++) {
    const hourly = data[i]?.hourly;
    if (!hourly) continue;
    for (let k = 0; k < hourly.time.length; k++) {
      const t = hourly.time[k] * 1000;
      if (t > cutoff) continue;
      const key = monthKey(t);
      if (!months.has(key)) months.set(key, await loadMonth(key));
      const month = months.get(key);
      const idx = (t - month.start) / HOUR;
      const series = (month.stations[stations[i].id] ??= {});
      for (const [pollutant, variable] of Object.entries(VARIABLES)) {
        const v = hourly[variable]?.[k];
        if (v == null) continue;
        const arr = (series[pollutant] ??= new Array(month.hours).fill(null));
        if (arr[idx] !== v) written++;
        arr[idx] = v;
      }
    }
  }

  for (const r of await fetchOpenAq(stations, pastDays)) {
    if (r.t > cutoff) continue;
    const key = monthKey(r.t);
    if (!months.has(key)) months.set(key, await loadMonth(key));
    const month = months.get(key);
    const arr = ((month.stations[r.station] ??= {})[r.pollutant] ??= new Array(month.hours).fill(null));
    const idx = (r.t - month.start) / HOUR;
    if (arr[idx] !== r.value) written++;
    arr[idx] = r.value; // measurement wins over model value
  }

  await mkdir(outDir, { recursive: true });
  for (const [key, month] of months) await writeFile(join(outDir, `${key}.json`), JSON.stringify(month));

  let existing = [];
  try {
    existing = JSON.parse(await readFile(join(outDir, "index.json"), "utf8")).months ?? [];
  } catch {}
  const all = [...new Set([...existing, ...months.keys()])].sort();
  await writeFile(join(outDir, "index.json"), JSON.stringify({ updated: new Date().toISOString(), months: all }, null, 1) + "\n");
  console.log(`Archived ${written} changed values across ${months.size} month file(s); index: ${all.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
