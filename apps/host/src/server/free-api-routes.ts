import { Hono } from 'hono';

/**
 * Keyless public APIs used by onboarding and the desktop widgets.
 *
 * Everything here is proxied through the host so the renderer keeps its strict
 * Content-Security-Policy (`connect-src 'self'`) and so responses can be cached
 * and normalised in one place. None of these providers require an API key:
 *
 *   Countries / states / cities : countriesnow.space
 *   Reverse geocoding          : bigdatacloud.net
 *   Weather + air quality      : open-meteo.com (forecast, geocoding, air)
 *   Crypto prices              : coingecko.com
 *   Foreign exchange           : open.er-api.com
 *   Encyclopaedia summaries    : wikipedia.org REST
 *   Public holidays            : date.nager.at
 */

async function fetchJson(
  url: string,
  init?: RequestInit,
  timeoutMs = 12000,
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchJsonPost(url: string, body: unknown): Promise<unknown> {
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Some providers answer 204 / an empty body for a perfectly valid request (a
// year with no published holidays, for instance). Callers get null instead of
// a parse error.
async function fetchJsonOrNull(
  url: string,
  timeoutMs = 12000,
): Promise<unknown | null> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim()) return null;
  return JSON.parse(text) as unknown;
}

interface CacheEntry {
  value: unknown;
  expires: number;
}

const cache = new Map<string, CacheEntry>();

async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

const DAY = 24 * 60 * 60 * 1000;

export function freeApiRoutes() {
  const app = new Hono();

  // Every country, alphabetical. Cached for a day because the list is stable.
  // CountriesNow is keyless and pairs with the states/cities calls below.
  app.get('/geo/countries', async (c) => {
    try {
      const countries = await cached('countries', DAY, async () => {
        const payload = (await fetchJson(
          'https://countriesnow.space/api/v0.1/countries/capital',
        )) as { data?: { name?: string }[] };
        return (payload.data ?? [])
          .map((entry) => entry.name ?? '')
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
      });
      return c.json({ countries });
    } catch (error) {
      return c.json(
        {
          countries: [],
          error:
            error instanceof Error ? error.message : 'Country list unavailable.',
        },
        502,
      );
    }
  });

  // CountriesNow addresses a country by its full name, so "IN" or "IND" has to
  // become "India" first. Onboarding and the voice location flow both send
  // ISO codes, and those calls used to fail upstream with a bare 404.
  const countryIndex = async (): Promise<
    { name: string; iso2: string; iso3: string }[]
  > =>
    cached('countries:index', DAY, async () => {
      const payload = (await fetchJson(
        'https://countriesnow.space/api/v0.1/countries/capital',
      )) as {
        data?: { name?: string; iso2?: string; iso3?: string }[];
      };
      return (payload.data ?? [])
        .map((entry) => ({
          name: entry.name ?? '',
          iso2: (entry.iso2 ?? '').toUpperCase(),
          iso3: (entry.iso3 ?? '').toUpperCase(),
        }))
        .filter((entry) => entry.name);
    });

  const resolveCountryName = async (input: string): Promise<string> => {
    const value = input.trim();
    if (value.length > 3) return value;
    try {
      const index = await countryIndex();
      const hit = index.find(
        (entry) => entry.iso2 === value.toUpperCase() || entry.iso3 === value.toUpperCase(),
      );
      return hit?.name ?? value;
    } catch {
      return value;
    }
  };

  // States / provinces for a country.
  app.get('/geo/states', async (c) => {
    const country = c.req.query('country')?.trim();
    if (!country) return c.json({ states: [], error: 'country required' }, 400);
    try {
      const countryName = await resolveCountryName(country);
      const states = await cached(`states:${countryName}`, 7 * DAY, async () => {
        const payload = (await fetchJsonPost(
          'https://countriesnow.space/api/v0.1/countries/states',
          { country: countryName },
        )) as { data?: { states?: { name?: string }[] } };
        return (payload.data?.states ?? [])
          .map((state) => state.name ?? '')
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
      });
      return c.json({ states });
    } catch (error) {
      return c.json(
        {
          states: [],
          error: error instanceof Error ? error.message : 'State list unavailable.',
        },
        502,
      );
    }
  });

  // Cities inside a state.
  app.get('/geo/cities', async (c) => {
    const country = c.req.query('country')?.trim();
    const state = c.req.query('state')?.trim();
    if (!country || !state)
      return c.json({ cities: [], error: 'country and state required' }, 400);
    try {
      const countryName = await resolveCountryName(country);
      const cities = await cached(
        `cities:${countryName}:${state}`,
        7 * DAY,
        async () => {
          const payload = (await fetchJsonPost(
            'https://countriesnow.space/api/v0.1/countries/state/cities',
            { country: countryName, state },
          )) as { data?: string[] };
          return (payload.data ?? []).filter(Boolean).sort((a, b) => a.localeCompare(b));
        },
      );
      return c.json({ cities });
    } catch (error) {
      return c.json(
        {
          cities: [],
          error: error instanceof Error ? error.message : 'City list unavailable.',
        },
        502,
      );
    }
  });

  // Coordinates -> human readable place. Used by "Use my location".
  app.get('/geo/reverse', async (c) => {
    const lat = Number(c.req.query('lat'));
    const lon = Number(c.req.query('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon))
      return c.json({ error: 'lat and lon required' }, 400);
    try {
      const payload = (await fetchJson(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      )) as {
        countryName?: string;
        principalSubdivision?: string;
        city?: string;
        locality?: string;
        postcode?: string;
      };
      return c.json({
        country: payload.countryName ?? '',
        state: payload.principalSubdivision ?? '',
        city: payload.city || payload.locality || '',
        postalCode: payload.postcode ?? '',
        lat,
        lon,
      });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error ? error.message : 'Location lookup failed.',
        },
        502,
      );
    }
  });

  // Current conditions + daily forecast. Open-Meteo is keyless and CORS-free,
  // but we still proxy it so widgets share one cache.
  app.get('/weather', async (c) => {
    const lat = Number(c.req.query('lat'));
    const lon = Number(c.req.query('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon))
      return c.json({ error: 'lat and lon required' }, 400);
    const unit = c.req.query('unit') === 'fahrenheit' ? 'fahrenheit' : 'celsius';
    try {
      const payload = (await cached(
        `weather:${lat.toFixed(2)}:${lon.toFixed(2)}:${unit}`,
        10 * 60 * 1000,
        async () =>
          fetchJson(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
              '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m' +
              '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
              `&timezone=auto&temperature_unit=${unit}&forecast_days=5`,
          ),
      )) as {
        current?: Record<string, number | string>;
        daily?: Record<string, Array<number | string>>;
        timezone?: string;
      };
      return c.json({
        current: payload.current ?? {},
        daily: payload.daily ?? {},
        timezone: payload.timezone ?? '',
        unit,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error ? error.message : 'Weather unavailable.',
        },
        502,
      );
    }
  });

  // Forward geocoding ("Pune" -> coordinates) for weather by city name.
  app.get('/weather/place', async (c) => {
    const name = c.req.query('name')?.trim();
    if (!name) return c.json({ results: [], error: 'name required' }, 400);
    try {
      const results = await cached(`place:${name}`, DAY, async () => {
        const payload = (await fetchJson(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=en&format=json`,
        )) as {
          results?: {
            name?: string;
            country?: string;
            admin1?: string;
            latitude?: number;
            longitude?: number;
          }[];
        };
        return (payload.results ?? []).map((place) => ({
          name: place.name ?? '',
          country: place.country ?? '',
          state: place.admin1 ?? '',
          lat: place.latitude ?? 0,
          lon: place.longitude ?? 0,
        }));
      });
      return c.json({ results });
    } catch (error) {
      return c.json(
        {
          results: [],
          error: error instanceof Error ? error.message : 'Place lookup failed.',
        },
        502,
      );
    }
  });

  // Air quality for a coordinate. Same keyless Open-Meteo family as weather, so
  // widgets can show PM2.5 / AQI alongside the forecast without another key.
  app.get('/air', async (c) => {
    const lat = Number(c.req.query('lat'));
    const lon = Number(c.req.query('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon))
      return c.json({ error: 'lat and lon required' }, 400);
    try {
      const payload = (await cached(
        `air:${lat.toFixed(2)}:${lon.toFixed(2)}`,
        20 * 60 * 1000,
        async () =>
          fetchJson(
            'https://air-quality-api.open-meteo.com/v1/air-quality' +
              `?latitude=${lat}&longitude=${lon}` +
              '&current=pm2_5,pm10,us_aqi,european_aqi,ozone,nitrogen_dioxide' +
              '&timezone=auto',
          ),
      )) as { current?: Record<string, number | string> };
      return c.json({
        current: payload.current ?? {},
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error ? error.message : 'Air quality unavailable.',
        },
        502,
      );
    }
  });

  // Spot crypto prices. CoinGecko's public endpoint needs no key; ids come from
  // the widget as a comma list (bitcoin,ethereum).
  app.get('/finance/crypto', async (c) => {
    const ids = (c.req.query('ids') ?? 'bitcoin,ethereum').trim();
    const vs = (c.req.query('vs') ?? 'usd').trim();
    if (!/^[a-z0-9,\-]+$/i.test(ids) || !/^[a-z0-9,\-]+$/i.test(vs))
      return c.json({ prices: {}, error: 'invalid ids or vs' }, 400);
    try {
      const prices = await cached(`crypto:${ids}:${vs}`, 60 * 1000, async () => {
        const payload = (await fetchJson(
          `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true&include_last_updated_at=true`,
        )) as Record<string, Record<string, number>>;
        return payload ?? {};
      });
      return c.json({ prices, updatedAt: new Date().toISOString() });
    } catch (error) {
      return c.json(
        {
          prices: {},
          error: error instanceof Error ? error.message : 'Crypto unavailable.',
        },
        502,
      );
    }
  });

  // Foreign-exchange rates. open.er-api.com is keyless and refreshed daily.
  app.get('/finance/rates', async (c) => {
    const base = (c.req.query('base') ?? 'USD').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(base))
      return c.json({ rates: {}, error: 'base must be a 3-letter code' }, 400);
    try {
      const payload = (await cached(`rates:${base}`, 6 * 60 * 60 * 1000, async () => {
        const data = (await fetchJsonOrNull(
          `https://open.er-api.com/v6/latest/${base}`,
        )) as {
          result?: string;
          time_last_update_utc?: string;
          rates?: Record<string, number>;
        } | null;
        return {
          result: data?.result ?? 'error',
          updatedAt: data?.time_last_update_utc ?? '',
          rates: data?.rates ?? {},
        };
      }));
      return c.json({ base, ...payload });
    } catch (error) {
      return c.json(
        {
          rates: {},
          error: error instanceof Error ? error.message : 'Rates unavailable.',
        },
        502,
      );
    }
  });

  // Wikipedia summary for a page title. Keyless, and a fast way for the agent
  // to ground a short factual answer with an attributable source.
  app.get('/knowledge/summary', async (c) => {
    const title = c.req.query('title')?.trim();
    if (!title) return c.json({ error: 'title required' }, 400);
    try {
      const data = (await cached(`wiki:${title}`, DAY, async () =>
        fetchJsonOrNull(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
            title.replace(/\s+/g, '_'),
          )}`,
        ),
      )) as {
        title?: string;
        extract?: string;
        description?: string;
        content_urls?: { desktop?: { page?: string } };
        thumbnail?: { source?: string };
      } | null;
      if (!data) return c.json({ error: 'not found' }, 404);
      return c.json({
        title: data.title ?? title,
        description: data.description ?? '',
        extract: data.extract ?? '',
        url: data.content_urls?.desktop?.page ?? '',
        thumbnail: data.thumbnail?.source ?? '',
      });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error ? error.message : 'Summary unavailable.',
        },
        502,
      );
    }
  });

  // Public holidays for a country and year. date.nager.at is keyless and
  // answers 204 when a year is not published yet, which becomes an empty list.
  app.get('/holidays', async (c) => {
    const country = (c.req.query('country') ?? '').trim().toUpperCase();
    const year = Number(c.req.query('year')) || new Date().getFullYear();
    if (!/^[A-Z]{2}$/.test(country))
      return c.json({ holidays: [], error: 'country must be a 2-letter code' }, 400);
    try {
      const holidays = await cached(
        `holidays:${country}:${year}`,
        DAY,
        async () => {
          const data = (await fetchJsonOrNull(
            `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`,
          )) as
            | {
                date?: string;
                localName?: string;
                name?: string;
                global?: boolean;
                types?: string[];
              }[]
            | null;
          return (data ?? []).map((day) => ({
            date: day.date ?? '',
            name: day.localName || day.name || '',
            global: day.global ?? false,
            types: day.types ?? [],
          }));
        },
      );
      return c.json({ country, year, holidays });
    } catch (error) {
      return c.json(
        {
          holidays: [],
          error:
            error instanceof Error ? error.message : 'Holidays unavailable.',
        },
        502,
      );
    }
  });

  return app;
}