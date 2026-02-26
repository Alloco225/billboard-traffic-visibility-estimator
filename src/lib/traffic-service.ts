// lib/traffic-service.ts - Google Maps traffic estimation service
import { Client, LatLngLiteral } from '@googlemaps/google-maps-services-js';
import { destinationPoint, calculateBearing } from './google-helpers';
import { dbOperations, Billboard } from './db';

const client = new Client({});

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY!;

// Road type to average daily traffic multipliers (vehicles per day per lane)
const ROAD_TYPE_DAILY_TRAFFIC: Record<string, number> = {
  highway: 25000,
  arterial: 15000,
  collector: 8000,
  local: 3000,
  default: 10000
};

interface TrafficResult {
  id: number;
  current_speed_kmh: number | null;
  congestion_ratio: number | null;
  traffic_level: 'low' | 'medium' | 'heavy' | 'jammed' | null;
  estimated_daily_traffic: number | null;
  error?: string;
}

/**
 * Estimate daily traffic volume based on speed and road characteristics
 * This is a simplified model - real traffic counting requires sensors or historical data
 */
function estimateDailyTraffic(
  speedKmh: number,
  speedLimitKmh: number | null,
  congestionRatio: number
): number {
  // Infer road type from speed limit
  const limit = speedLimitKmh ?? speedKmh * 1.2;
  let roadType = 'default';

  if (limit >= 100) roadType = 'highway';
  else if (limit >= 70) roadType = 'arterial';
  else if (limit >= 50) roadType = 'collector';
  else roadType = 'local';

  const baseTraffic = ROAD_TYPE_DAILY_TRAFFIC[roadType];

  // Adjust based on current congestion (high congestion = high demand)
  // congestionRatio: 1 = free flow, <0.3 = jammed
  // Lower ratio means more traffic
  const demandMultiplier = congestionRatio < 0.5 ? 1.3 : congestionRatio < 0.8 ? 1.1 : 1.0;

  return Math.round(baseTraffic * demandMultiplier);
}

/**
 * Snap billboard location to nearest road and get road properties
 */
export async function snapToRoad(billboard: Billboard): Promise<{
  snapped_lat: number;
  snapped_lng: number;
  road_bearing: number;
  posted_speed_limit_kmh: number | null;
} | null> {
  try {
    const point = { lat: billboard.lat, lng: billboard.lng };
    // Create a small offset point to help determine road direction
    const offset = destinationPoint(point, 40, 45);

    const snapRes = await client.snapToRoads({
      params: {
        path: [point, offset],
        interpolate: true,
        key: GOOGLE_MAPS_API_KEY
      }
    });

    const snappedPoints = snapRes.data.snappedPoints;
    if (!snappedPoints?.length) return null;

    const snapped = snappedPoints[0].location;
    const bearing = snappedPoints.length > 1
      ? calculateBearing(
          { lat: snappedPoints[0].location.latitude, lng: snappedPoints[0].location.longitude },
          { lat: snappedPoints[1].location.latitude, lng: snappedPoints[1].location.longitude }
        )
      : 0;

    // Try to get speed limit via Roads API
    let speedLimit: number | null = null;
    if (snappedPoints[0].placeId) {
      try {
        const speedRes = await fetch(
          `https://roads.googleapis.com/v1/speedLimits?placeId=${snappedPoints[0].placeId}&key=${GOOGLE_MAPS_API_KEY}`
        );
        const speedData = await speedRes.json();
        speedLimit = speedData.speedLimits?.[0]?.speedLimit ?? null;
      } catch {
        // Speed limits API might not be available in all regions
      }
    }

    return {
      snapped_lat: snapped.latitude,
      snapped_lng: snapped.longitude,
      road_bearing: bearing,
      posted_speed_limit_kmh: speedLimit
    };
  } catch (error) {
    console.error('Snap to road error:', error);
    return null;
  }
}

/**
 * Parse duration from various Google API formats
 * Could be: "142s", "1.5s", { seconds: 142 }, or number
 */
function parseDuration(duration: unknown): number {
  if (typeof duration === 'number') return duration;
  if (typeof duration === 'string') {
    return parseFloat(duration.replace('s', '')) || 0;
  }
  if (duration && typeof duration === 'object' && 'seconds' in duration) {
    return Number((duration as { seconds: string | number }).seconds) || 0;
  }
  return 0;
}

/**
 * Get real-time traffic data for a billboard location using Directions API
 * (More reliable than Routes API for this use case)
 */
export async function getTrafficForBillboard(billboard: Billboard): Promise<TrafficResult> {
  try {
    // Use snapped coordinates if available, otherwise original
    const center: LatLngLiteral = {
      lat: billboard.snapped_lat ?? billboard.lat,
      lng: billboard.snapped_lng ?? billboard.lng
    };

    const bearing = billboard.road_bearing ?? 0;
    const segmentLength = billboard.segment_length_m ?? 300;
    const halfSegment = segmentLength / 2;

    // If we have facing azimuth, shift center slightly toward the panel side
    let adjustedCenter = center;
    if (billboard.facing_azimuth != null) {
      adjustedCenter = destinationPoint(center, 30, billboard.facing_azimuth);
    }

    // Create origin and destination points along the road
    const origin = destinationPoint(adjustedCenter, halfSegment, (bearing + 180) % 360);
    const destination = destinationPoint(adjustedCenter, halfSegment, bearing);

    console.log(`[Traffic] Billboard ${billboard.id}: origin=${origin.lat},${origin.lng} dest=${destination.lat},${destination.lng}`);

    // Use Directions API with departure_time for traffic data
    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', `${origin.lat},${origin.lng}`);
    url.searchParams.set('destination', `${destination.lat},${destination.lng}`);
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('departure_time', 'now');
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

    const response = await fetch(url.toString());
    const data = await response.json();

    console.log(`[Traffic] Billboard ${billboard.id}: status=${data.status}`);

    if (data.status !== 'OK' || !data.routes?.length) {
      // Try with slightly larger distance
      return await getTrafficWithLargerSegment(billboard, center, bearing);
    }

    const leg = data.routes[0].legs[0];
    const distanceM = leg.distance?.value || segmentLength;
    const durationSec = leg.duration_in_traffic?.value || leg.duration?.value || 0;
    const staticSec = leg.duration?.value || durationSec;

    console.log(`[Traffic] Billboard ${billboard.id}: distance=${distanceM}m, duration=${durationSec}s, static=${staticSec}s`);

    if (durationSec === 0 || distanceM === 0) {
      // Fallback: use larger segment
      return await getTrafficWithLargerSegment(billboard, center, bearing);
    }

    const speedKmh = (distanceM / 1000) / (durationSec / 3600);
    const freeSpeedKmh = staticSec > 0 ? (distanceM / 1000) / (staticSec / 3600) : speedKmh;
    const congestionRatio = freeSpeedKmh > 0 ? Math.min(speedKmh / freeSpeedKmh, 1) : 1;

    let trafficLevel: 'low' | 'medium' | 'heavy' | 'jammed';
    if (congestionRatio > 0.9) trafficLevel = 'low';
    else if (congestionRatio > 0.6) trafficLevel = 'medium';
    else if (congestionRatio > 0.3) trafficLevel = 'heavy';
    else trafficLevel = 'jammed';

    const estimatedDaily = estimateDailyTraffic(
      speedKmh,
      billboard.posted_speed_limit_kmh,
      congestionRatio
    );

    return {
      id: billboard.id,
      current_speed_kmh: Math.round(speedKmh * 10) / 10,
      congestion_ratio: Math.round(congestionRatio * 100) / 100,
      traffic_level: trafficLevel,
      estimated_daily_traffic: estimatedDaily
    };
  } catch (error) {
    console.error(`[Traffic] Error for billboard ${billboard.id}:`, error);
    return {
      id: billboard.id,
      current_speed_kmh: null,
      congestion_ratio: null,
      traffic_level: null,
      estimated_daily_traffic: null,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Fallback: Try with a larger road segment (500m instead of 150m each side)
 */
async function getTrafficWithLargerSegment(
  billboard: Billboard,
  center: LatLngLiteral,
  bearing: number
): Promise<TrafficResult> {
  const halfSegment = 500; // 1km total segment

  const origin = destinationPoint(center, halfSegment, (bearing + 180) % 360);
  const destination = destinationPoint(center, halfSegment, bearing);

  console.log(`[Traffic] Billboard ${billboard.id}: Retrying with larger segment`);

  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', `${origin.lat},${origin.lng}`);
  url.searchParams.set('destination', `${destination.lat},${destination.lng}`);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('departure_time', 'now');
  url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status !== 'OK' || !data.routes?.length) {
    return {
      id: billboard.id,
      current_speed_kmh: null,
      congestion_ratio: null,
      traffic_level: null,
      estimated_daily_traffic: null,
      error: `Directions API error: ${data.status || 'No routes found'}`
    };
  }

  const leg = data.routes[0].legs[0];
  const distanceM = leg.distance?.value || 1000;
  const durationSec = leg.duration_in_traffic?.value || leg.duration?.value || 0;
  const staticSec = leg.duration?.value || durationSec;

  if (durationSec === 0) {
    return {
      id: billboard.id,
      current_speed_kmh: null,
      congestion_ratio: null,
      traffic_level: null,
      estimated_daily_traffic: null,
      error: 'Could not calculate duration for this location'
    };
  }

  const speedKmh = (distanceM / 1000) / (durationSec / 3600);
  const freeSpeedKmh = staticSec > 0 ? (distanceM / 1000) / (staticSec / 3600) : speedKmh;
  const congestionRatio = freeSpeedKmh > 0 ? Math.min(speedKmh / freeSpeedKmh, 1) : 1;

  let trafficLevel: 'low' | 'medium' | 'heavy' | 'jammed';
  if (congestionRatio > 0.9) trafficLevel = 'low';
  else if (congestionRatio > 0.6) trafficLevel = 'medium';
  else if (congestionRatio > 0.3) trafficLevel = 'heavy';
  else trafficLevel = 'jammed';

  const estimatedDaily = estimateDailyTraffic(
    speedKmh,
    billboard.posted_speed_limit_kmh,
    congestionRatio
  );

  return {
    id: billboard.id,
    current_speed_kmh: Math.round(speedKmh * 10) / 10,
    congestion_ratio: Math.round(congestionRatio * 100) / 100,
    traffic_level: trafficLevel,
    estimated_daily_traffic: estimatedDaily
  };
}


/**
 * Refresh traffic data for a single billboard and update DB
 */
export async function refreshBillboardTraffic(id: number): Promise<TrafficResult> {
  const billboard = dbOperations.getById(id);
  if (!billboard) {
    throw new Error(`Billboard ${id} not found`);
  }

  // First, snap to road if not already done
  if (billboard.snapped_lat == null) {
    const snapData = await snapToRoad(billboard);
    if (snapData) {
      dbOperations.updateSnapped(id, snapData);
    }
  }

  // Get fresh traffic data
  const result = await getTrafficForBillboard(
    dbOperations.getById(id)! // Re-fetch to get snapped data
  );

  // Update database
  if (!result.error) {
    dbOperations.updateTraffic(id, {
      current_speed_kmh: result.current_speed_kmh,
      congestion_ratio: result.congestion_ratio,
      traffic_level: result.traffic_level,
      estimated_daily_traffic: result.estimated_daily_traffic
    });
  }

  return result;
}

/**
 * Refresh traffic for all billboards
 */
export async function refreshAllTraffic(): Promise<TrafficResult[]> {
  const billboards = dbOperations.getAll();
  const results: TrafficResult[] = [];

  for (const billboard of billboards) {
    const result = await refreshBillboardTraffic(billboard.id);
    results.push(result);
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  return results;
}
