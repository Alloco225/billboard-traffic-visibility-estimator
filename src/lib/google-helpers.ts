// lib/google-helpers.ts
import type { LatLngLiteral } from '@googlemaps/google-maps-services-js';

const EARTH_RADIUS_KM = 6371;

export function toRad(deg: number): number {
  return deg * Math.PI / 180;
}

export function calculateBearing(from: LatLngLiteral, to: LatLngLiteral): number {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLon = toRad(to.lng - from.lng);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

export function destinationPoint(
  origin: LatLngLiteral,
  distanceMeters: number,
  bearingDegrees: number
): LatLngLiteral {
  const distKm = distanceMeters / 1000;
  const brngRad = toRad(bearingDegrees);
  const latRad = toRad(origin.lat);

  const newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(distKm / EARTH_RADIUS_KM) +
    Math.cos(latRad) * Math.sin(distKm / EARTH_RADIUS_KM) * Math.cos(brngRad)
  );

  const newLngRad = toRad(origin.lng) + Math.atan2(
    Math.sin(brngRad) * Math.sin(distKm / EARTH_RADIUS_KM) * Math.cos(latRad),
    Math.cos(distKm / EARTH_RADIUS_KM) - Math.sin(latRad) * Math.sin(newLatRad)
  );

  return {
    lat: newLatRad * 180 / Math.PI,
    lng: (newLngRad * 180 / Math.PI + 540) % 360 - 180,
  };
}

export function parseGoogleDuration(durationStr: string): number {
  return parseFloat(durationStr.replace('s', ''));
}