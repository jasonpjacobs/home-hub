import { addDays, diffDays } from './taskEngine.js';

const weatherCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

export const WEATHER_TRIGGERS = [
  { id: 'none', label: 'None (Not weather-dependent)' },
  { id: 'rain_soon', label: 'Rain forecasted (≥55% chance or rain expected)' },
  { id: 'freeze_soon', label: 'Freeze forecasted (low ≤ 32°F / 0°C)' },
  { id: 'snow_soon', label: 'Snow forecasted' },
  { id: 'high_wind', label: 'High wind gusts (≥ 30 mph)' },
  { id: 'heat_wave', label: 'Heat wave (high ≥ 90°F)' },
  { id: 'dry_clear_day', label: 'Dry, clear day ahead (great for lawn/car)' },
];

export const WEATHER_SIMULATION_PRESETS = [
  { id: '', label: 'Live 10-Day Forecast (Open-Meteo)' },
  { id: 'rain_and_freeze', label: 'Simulated: Rain in 2 days (Urgent) + Freeze in 6 days (Heads-Up)' },
  { id: 'snow_storm', label: 'Simulated: Snow & Wind in 2 days (Urgent)' },
  { id: 'heat_wave', label: 'Simulated: Heat Wave (95°F) in 3 days (Urgent)' },
  { id: 'clear_week', label: 'Simulated: Clear & Dry 10-Day Outlook' },
];

function describeWeatherCode(code) {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly Cloudy';
  if (code <= 48) return 'Foggy';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain Showers';
  if (code <= 86) return 'Snow Showers';
  return 'Thunderstorm';
}

export function buildSimulatedForecast(preset, todayStr) {
  const days = [];
  for (let i = 0; i < 10; i++) {
    const date = addDays(todayStr, i);
    let tempMax = 58;
    let tempMin = 42;
    let precipProb = 15;
    let precipMm = 0;
    let snowfallCm = 0;
    let windMaxMph = 10;
    let condition = 'Partly Cloudy';

    if (preset === 'rain_and_freeze') {
      if (i === 2) {
        precipProb = 85;
        precipMm = 14.2;
        windMaxMph = 18;
        tempMax = 52;
        tempMin = 41;
        condition = 'Heavy Rain';
      } else if (i === 3) {
        precipProb = 65;
        precipMm = 5.4;
        condition = 'Rain Showers';
      } else if (i === 6 || i === 7) {
        tempMax = 41;
        tempMin = 28;
        precipProb = 20;
        condition = 'Hard Freeze Overnight';
      }
    } else if (preset === 'snow_storm') {
      if (i === 2) {
        tempMax = 33;
        tempMin = 24;
        precipProb = 90;
        snowfallCm = 9.5;
        windMaxMph = 36;
        condition = 'Snow & High Wind';
      }
    } else if (preset === 'heat_wave') {
      if (i >= 2 && i <= 4) {
        tempMax = 95;
        tempMin = 71;
        precipProb = 5;
        condition = 'Hot & Sunny';
      } else {
        tempMax = 84;
        tempMin = 63;
        condition = 'Sunny';
      }
    } else if (preset === 'clear_week') {
      tempMax = 68;
      tempMin = 50;
      precipProb = 5;
      condition = 'Clear & Dry';
    }

    days.push({
      date,
      daysAway: i,
      tempMax,
      tempMin,
      precipProb,
      precipMm,
      snowfallCm,
      windMaxMph,
      condition,
    });
  }
  return days;
}

export async function getTenDayForecast(household, todayStr) {
  const preset = household.simulatedWeather || '';
  if (preset) {
    return {
      source: 'simulated',
      preset,
      locationName: household.locationName || 'Home',
      days: buildSimulatedForecast(preset, todayStr),
      error: null,
    };
  }

  const lat = Number(household.latitude);
  const lon = Number(household.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      source: 'unconfigured',
      preset: '',
      locationName: household.locationName || '',
      days: [],
      error: 'Set household latitude/longitude (or choose a preset) to enable weather triggers.',
    };
  }

  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)},${household.timezone || 'auto'}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set(
      'daily',
      'weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,snowfall_sum,windspeed_10m_max',
    );
    url.searchParams.set('temperature_unit', 'fahrenheit');
    url.searchParams.set('windspeed_unit', 'mph');
    url.searchParams.set('forecast_days', '10');
    url.searchParams.set('timezone', household.timezone || 'auto');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`Open-Meteo HTTP ${res.status}`);
    }
    const json = await res.json();
    const d = json.daily || {};
    const dates = d.time || [];

    const days = dates.map((date, idx) => ({
      date,
      daysAway: Math.max(0, diffDays(date, todayStr)),
      tempMax: Math.round(d.temperature_2m_max?.[idx] ?? 60),
      tempMin: Math.round(d.temperature_2m_min?.[idx] ?? 45),
      precipProb: Math.round(d.precipitation_probability_max?.[idx] ?? 0),
      precipMm: Number((d.precipitation_sum?.[idx] ?? 0).toFixed(1)),
      snowfallCm: Number((d.snowfall_sum?.[idx] ?? 0).toFixed(1)),
      windMaxMph: Math.round(d.windspeed_10m_max?.[idx] ?? 0),
      condition: describeWeatherCode(d.weathercode?.[idx] ?? 0),
    }));

    const result = {
      source: 'open_meteo',
      preset: '',
      locationName: household.locationName || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
      days,
      error: null,
    };
    weatherCache.set(cacheKey, { fetchedAt: Date.now(), result });
    return result;
  } catch (err) {
    return {
      source: 'offline_fallback',
      preset: '',
      locationName: household.locationName || 'Home',
      days: [],
      error: `Live weather temporarily unavailable (${err.message}). You can use a weather simulation preset locally.`,
    };
  }
}

export function matchWeatherTrigger(trigger, days) {
  if (!trigger || trigger === 'none' || !Array.isArray(days) || days.length === 0) return null;

  const matcher = (day) => {
    switch (trigger) {
      case 'rain_soon':
        return day.precipProb >= 55 || day.precipMm >= 3;
      case 'freeze_soon':
        return day.tempMin <= 32;
      case 'snow_soon':
        return day.snowfallCm > 0 || (day.condition || '').toLowerCase().includes('snow');
      case 'high_wind':
        return day.windMaxMph >= 30;
      case 'heat_wave':
        return day.tempMax >= 90;
      case 'dry_clear_day':
        return day.daysAway <= 3 && day.precipProb <= 15 && day.tempMax >= 55;
      default:
        return false;
    }
  };

  const matchedDay = days.find(matcher);
  if (!matchedDay) return null;

  // Two-tier horizon: <= 3 days -> urgent; 4..10 days -> heads_up (gentle reminder)
  const urgency = matchedDay.daysAway <= 3 ? 'urgent' : 'heads_up';
  const whenText =
    matchedDay.daysAway === 0
      ? 'today'
      : matchedDay.daysAway === 1
        ? 'tomorrow'
        : `in ${matchedDay.daysAway} days (${matchedDay.date})`;

  let detail = '';
  if (trigger === 'rain_soon') {
    detail = `${matchedDay.condition} (${matchedDay.precipProb}% chance) ${whenText}`;
  } else if (trigger === 'freeze_soon') {
    detail = `Low of ${matchedDay.tempMin}°F ${whenText}`;
  } else if (trigger === 'snow_soon') {
    detail = `${matchedDay.condition} ${whenText}`;
  } else if (trigger === 'high_wind') {
    detail = `Wind gusts up to ${matchedDay.windMaxMph} mph ${whenText}`;
  } else if (trigger === 'heat_wave') {
    detail = `High of ${matchedDay.tempMax}°F ${whenText}`;
  } else if (trigger === 'dry_clear_day') {
    detail = `${matchedDay.condition} (${matchedDay.tempMax}°F) ${whenText}`;
  }

  return {
    trigger,
    urgency,
    matchedDate: matchedDay.date,
    daysAway: matchedDay.daysAway,
    summary: `${urgency === 'urgent' ? 'Urgent' : 'Heads-up'}: ${detail}`,
  };
}

/**
 * Evaluate all weather-dependent tasks against the 10-day forecast.
 * Respects task weatherCooldownDays so completed weather tasks don't immediately re-trigger.
 */
export function evaluateWeatherAlerts(forecastDays, tasks, instances, todayStr) {
  const alerts = [];
  for (const task of tasks) {
    if (task.active === false) continue;
    if (!task.weatherTrigger || task.weatherTrigger === 'none') continue;

    const match = matchWeatherTrigger(task.weatherTrigger, forecastDays);
    if (!match) continue;

    const cooldownDays = Math.max(1, Number(task.weatherCooldownDays) || 5);
    const recentlyCompleted = instances.some(
      (inst) =>
        inst.taskId === task.id &&
        inst.status === 'completed' &&
        inst.completedAt &&
        diffDays(todayStr, inst.completedAt.slice(0, 10)) < cooldownDays,
    );
    if (recentlyCompleted) continue;

    const existingPending = instances.find(
      (inst) =>
        inst.taskId === task.id &&
        ['pending', 'started', 'on_hold', 'gated'].includes(inst.status),
    );

    alerts.push({
      taskId: task.id,
      taskTitle: task.title,
      visibility: task.visibility || 'household',
      ownerId: task.ownerId || '',
      existingInstanceId: existingPending?.id || null,
      ...match,
    });
  }

  // Sort urgent first, then soonest
  alerts.sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency === 'urgent' ? -1 : 1;
    return a.daysAway - b.daysAway;
  });

  return alerts;
}
