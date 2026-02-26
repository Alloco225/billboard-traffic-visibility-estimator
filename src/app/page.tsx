'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  Polygon,
  InfoWindow,
  TrafficLayer,
} from '@react-google-maps/api';

interface Billboard {
  id: number;
  name: string;
  lat: number;
  lng: number;
  snapped_lat: number | null;
  snapped_lng: number | null;
  road_bearing: number | null;
  facing_azimuth: number | null;
  current_speed_kmh: number | null;
  congestion_ratio: number | null;
  traffic_level: 'low' | 'medium' | 'heavy' | 'jammed' | null;
  estimated_daily_traffic: number | null;
  last_traffic_update: string | null;
}

// Couleurs des panneaux - Bleus/Violets/Magentas pour contraster avec le trafic Google (vert/jaune/rouge)
const TRAFFIC_COLORS: Record<string, { fill: string; stroke: string; label: string }> = {
  low: { fill: 'rgba(59, 130, 246, 0.35)', stroke: '#3b82f6', label: 'Trafic fluide' },
  medium: { fill: 'rgba(139, 92, 246, 0.35)', stroke: '#8b5cf6', label: 'Trafic modéré' },
  heavy: { fill: 'rgba(217, 70, 239, 0.35)', stroke: '#d946ef', label: 'Trafic dense' },
  jammed: { fill: 'rgba(236, 72, 153, 0.35)', stroke: '#ec4899', label: 'Embouteillage' },
};

const MAP_CONTAINER_STYLE = {
  width: '100%',
  height: '100vh',
};

const DEFAULT_CENTER = { lat: 5.3484, lng: -4.0085 }; // Abidjan - Plateau/Cocody

// Générer les points du cône de visibilité
function generateViewCone(
  center: { lat: number; lng: number },
  azimuth: number,
  distance: number = 150,
  angleSpread: number = 60
): google.maps.LatLngLiteral[] {
  const points: google.maps.LatLngLiteral[] = [center];
  const earthRadius = 6371000;

  const startAngle = azimuth - angleSpread / 2;
  const endAngle = azimuth + angleSpread / 2;
  const steps = 20;

  for (let i = 0; i <= steps; i++) {
    const angle = startAngle + (endAngle - startAngle) * (i / steps);
    const angleRad = (angle * Math.PI) / 180;

    const dLat = (distance / earthRadius) * Math.cos(angleRad);
    const dLng = (distance / earthRadius) * Math.sin(angleRad) / Math.cos((center.lat * Math.PI) / 180);

    points.push({
      lat: center.lat + (dLat * 180) / Math.PI,
      lng: center.lng + (dLng * 180) / Math.PI,
    });
  }

  points.push(center);
  return points;
}

// Générer le cône en dégradé
function generateGradientCone(
  center: { lat: number; lng: number },
  azimuth: number,
  trafficLevel: string | null
): { points: google.maps.LatLngLiteral[]; distance: number; opacity: number }[] {
  const distances = [50, 100, 150];
  const opacities = [0.5, 0.3, 0.15];

  return distances.map((dist, i) => ({
    points: generateViewCone(center, azimuth, dist),
    distance: dist,
    opacity: opacities[i],
  }));
}

export default function Home() {
  const [billboards, setBillboards] = useState<Billboard[]>([]);
  const [selectedBillboard, setSelectedBillboard] = useState<Billboard | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', lat: '', lng: '', facing_azimuth: '' });
  const [refreshing, setRefreshing] = useState<number | null>(null);
  const [showTrafficLayer, setShowTrafficLayer] = useState(true);
  const [clickedLocation, setClickedLocation] = useState<google.maps.LatLngLiteral | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const initialLoadDone = useRef(false);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
    libraries: ['places'],
  });

  // Charger les panneaux sans réinitialiser la carte
  const fetchBillboards = useCallback(async (centerOnFirst = false) => {
    try {
      const res = await fetch('/api/billboards');
      const data = await res.json();
      setBillboards(data);

      // Centrer seulement au premier chargement
      if (centerOnFirst && data.length > 0 && mapRef.current) {
        const firstBb = data[0];
        mapRef.current.panTo({
          lat: firstBb.snapped_lat ?? firstBb.lat,
          lng: firstBb.snapped_lng ?? firstBb.lng,
        });
      }
    } catch (err) {
      console.error('Erreur lors du chargement des panneaux:', err);
    }
  }, []);

  useEffect(() => {
    fetchBillboards(true);
    initialLoadDone.current = true;
  }, [fetchBillboards]);

  const handleMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (e.latLng) {
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      setClickedLocation({ lat, lng });
      setFormData(prev => ({
        ...prev,
        lat: lat.toFixed(6),
        lng: lng.toFixed(6),
      }));
      setShowAddForm(true);
    }
  }, []);

  const handleAddBillboard = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const res = await fetch('/api/billboards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          facing_azimuth: formData.facing_azimuth || null,
        }),
      });

      if (res.ok) {
        setFormData({ name: '', lat: '', lng: '', facing_azimuth: '' });
        setShowAddForm(false);
        setClickedLocation(null);
        fetchBillboards(false);
      }
    } catch (err) {
      console.error('Erreur lors de l\'ajout:', err);
    }
  };

  const handleRefreshTraffic = async (id: number) => {
    setRefreshing(id);
    try {
      await fetch(`/api/billboards/${id}/traffic`, { method: 'POST' });
      await fetchBillboards(false);
    } catch (err) {
      console.error('Erreur lors de l\'actualisation:', err);
    } finally {
      setRefreshing(null);
    }
  };

  const handleRefreshAll = async () => {
    setRefreshing(-1);
    try {
      await fetch('/api/traffic/refresh-all', { method: 'POST' });
      await fetchBillboards(false);
    } catch (err) {
      console.error('Erreur lors de l\'actualisation:', err);
    } finally {
      setRefreshing(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Supprimer ce panneau ?')) return;
    try {
      await fetch(`/api/billboards/${id}`, { method: 'DELETE' });
      setSelectedBillboard(null);
      fetchBillboards(false);
    } catch (err) {
      console.error('Erreur lors de la suppression:', err);
    }
  };

  const goToBillboard = useCallback((bb: Billboard) => {
    setSelectedBillboard(bb);
    if (mapRef.current) {
      mapRef.current.panTo({
        lat: bb.snapped_lat ?? bb.lat,
        lng: bb.snapped_lng ?? bb.lng,
      });
    }
  }, []);

  const mapOptions = useMemo(() => ({
    disableDefaultUI: false,
    zoomControl: true,
    streetViewControl: true,
    mapTypeControl: true,
    fullscreenControl: true,
    styles: [
      {
        featureType: 'poi',
        elementType: 'labels',
        stylers: [{ visibility: 'off' }],
      },
    ],
  }), []);

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-900 text-white">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Erreur de chargement</h1>
          <p>Vérifiez la configuration de votre clé API Google Maps.</p>
          <p className="text-sm text-zinc-400 mt-2">
            Ajoutez NEXT_PUBLIC_GOOGLE_MAPS_API_KEY dans votre fichier .env
          </p>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-900 text-white">
        <div className="text-xl">Chargement de la carte...</div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-full">
      {/* Carte */}
      <GoogleMap
        mapContainerStyle={MAP_CONTAINER_STYLE}
        center={DEFAULT_CENTER}
        zoom={13}
        options={mapOptions}
        onClick={handleMapClick}
        onLoad={handleMapLoad}
      >
        {/* Couche trafic */}
        {showTrafficLayer && <TrafficLayer />}

        {/* Marqueurs et cônes de visibilité */}
        {billboards.map((billboard) => {
          const position = {
            lat: billboard.snapped_lat ?? billboard.lat,
            lng: billboard.snapped_lng ?? billboard.lng,
          };

          const facingAzimuth = billboard.facing_azimuth ?? billboard.road_bearing ?? 0;
          const trafficColor = TRAFFIC_COLORS[billboard.traffic_level || 'low'];

          return (
            <div key={billboard.id}>
              {/* Cône de visibilité en dégradé */}
              {generateGradientCone(position, facingAzimuth, billboard.traffic_level).map(
                (cone, i) => (
                  <Polygon
                    key={`cone-${billboard.id}-${i}`}
                    paths={cone.points}
                    options={{
                      fillColor: trafficColor.stroke,
                      fillOpacity: cone.opacity,
                      strokeColor: trafficColor.stroke,
                      strokeOpacity: i === 0 ? 0.8 : 0,
                      strokeWeight: i === 0 ? 2 : 0,
                    }}
                  />
                )
              )}

              {/* Marqueur du panneau */}
              <Marker
                position={position}
                onClick={() => setSelectedBillboard(billboard)}
                icon={{
                  path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                  scale: 6,
                  rotation: facingAzimuth,
                  fillColor: trafficColor.stroke,
                  fillOpacity: 1,
                  strokeColor: '#ffffff',
                  strokeWeight: 2,
                }}
                title={billboard.name}
              />
            </div>
          );
        })}

        {/* Marqueur de position cliquée */}
        {clickedLocation && (
          <Marker
            position={clickedLocation}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: '#3b82f6',
              fillOpacity: 0.8,
              strokeColor: '#ffffff',
              strokeWeight: 2,
            }}
          />
        )}

        {/* Fenêtre d'info du panneau sélectionné */}
        {selectedBillboard && (
          <InfoWindow
            position={{
              lat: selectedBillboard.snapped_lat ?? selectedBillboard.lat,
              lng: selectedBillboard.snapped_lng ?? selectedBillboard.lng,
            }}
            onCloseClick={() => setSelectedBillboard(null)}
          >
            <div className="p-2 min-w-[280px]">
              <h3 className="font-bold text-lg text-zinc-900 mb-2">
                {selectedBillboard.name}
              </h3>

              <div className="space-y-2 text-sm">
                {/* Badge niveau de trafic */}
                {selectedBillboard.traffic_level && (
                  <div
                    className="inline-block px-3 py-1 rounded-full text-white font-medium"
                    style={{
                      backgroundColor: TRAFFIC_COLORS[selectedBillboard.traffic_level].stroke,
                    }}
                  >
                    {TRAFFIC_COLORS[selectedBillboard.traffic_level].label}
                  </div>
                )}

                {/* Statistiques */}
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="bg-zinc-100 p-2 rounded">
                    <div className="text-xs text-zinc-500">Vitesse</div>
                    <div className="font-semibold text-zinc-900">
                      {selectedBillboard.current_speed_kmh ?? '-'} km/h
                    </div>
                  </div>
                  <div className="bg-zinc-100 p-2 rounded">
                    <div className="text-xs text-zinc-500">Congestion</div>
                    <div className="font-semibold text-zinc-900">
                      {selectedBillboard.congestion_ratio
                        ? `${Math.round(selectedBillboard.congestion_ratio * 100)}%`
                        : '-'}
                    </div>
                  </div>
                  <div className="bg-zinc-100 p-2 rounded col-span-2">
                    <div className="text-xs text-zinc-500">Trafic journalier estimé</div>
                    <div className="font-bold text-xl text-zinc-900">
                      {selectedBillboard.estimated_daily_traffic?.toLocaleString('fr-FR') ?? '-'}
                      <span className="text-xs font-normal text-zinc-500 ml-1">véhicules/jour</span>
                    </div>
                  </div>
                </div>

                {/* Coordonnées */}
                <div className="text-xs text-zinc-500 mt-2">
                  {selectedBillboard.lat.toFixed(5)}, {selectedBillboard.lng.toFixed(5)}
                  {selectedBillboard.facing_azimuth && (
                    <span className="ml-2">Orientation: {selectedBillboard.facing_azimuth}°</span>
                  )}
                </div>

                {/* Dernière mise à jour */}
                {selectedBillboard.last_traffic_update && (
                  <div className="text-xs text-zinc-400">
                    Mis à jour: {new Date(selectedBillboard.last_traffic_update).toLocaleString('fr-FR')}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 mt-3 pt-3 border-t border-zinc-200">
                  <button
                    onClick={() => handleRefreshTraffic(selectedBillboard.id)}
                    disabled={refreshing === selectedBillboard.id}
                    className="flex-1 px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 text-sm font-medium"
                  >
                    {refreshing === selectedBillboard.id ? 'Actualisation...' : 'Actualiser'}
                  </button>
                  <button
                    onClick={() => handleDelete(selectedBillboard.id)}
                    className="px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600 text-sm font-medium"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>

      {/* Panneau de contrôle */}
      <div className="absolute top-4 left-4 z-10 space-y-3">
        {/* En-tête */}
        <div className="bg-white/95 backdrop-blur rounded-lg shadow-lg p-4">
          <h1 className="font-bold text-lg text-zinc-900">Estimateur de Trafic</h1>
          <p className="text-xs text-zinc-500">Cliquez sur la carte pour ajouter un panneau</p>
        </div>

        {/* Actions */}
        <div className="bg-white/95 backdrop-blur rounded-lg shadow-lg p-3 space-y-2">
          <button
            onClick={handleRefreshAll}
            disabled={refreshing === -1}
            className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 font-medium text-sm"
          >
            {refreshing === -1 ? 'Actualisation...' : `Actualiser tout (${billboards.length})`}
          </button>

          <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
            <input
              type="checkbox"
              checked={showTrafficLayer}
              onChange={(e) => setShowTrafficLayer(e.target.checked)}
              className="rounded"
            />
            Afficher le trafic Google
          </label>
        </div>

        {/* Légende */}
        <div className="bg-white/95 backdrop-blur rounded-lg shadow-lg p-3">
          <div className="text-xs font-semibold text-zinc-700 mb-2">Légende</div>
          <div className="space-y-1">
            {Object.entries(TRAFFIC_COLORS).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2 text-xs">
                <div
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: value.stroke }}
                />
                <span className="text-zinc-700">{value.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Liste des panneaux */}
        {billboards.length > 0 && (
          <div className="bg-white/95 backdrop-blur rounded-lg shadow-lg p-3 max-h-[300px] overflow-y-auto">
            <div className="text-xs font-semibold text-zinc-700 mb-2">
              Panneaux ({billboards.length})
            </div>
            <div className="space-y-1">
              {billboards.map((bb) => (
                <button
                  key={bb.id}
                  onClick={() => goToBillboard(bb)}
                  className="w-full text-left px-2 py-1.5 hover:bg-zinc-100 rounded text-sm flex items-center gap-2"
                >
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: TRAFFIC_COLORS[bb.traffic_level || 'low'].stroke,
                    }}
                  />
                  <span className="truncate flex-1 text-zinc-900">{bb.name}</span>
                  {bb.estimated_daily_traffic && (
                    <span className="text-xs text-zinc-500 flex-shrink-0">
                      {(bb.estimated_daily_traffic / 1000).toFixed(0)}k
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Formulaire d'ajout */}
      {showAddForm && (
        <div className="absolute top-4 right-4 z-10 bg-white rounded-lg shadow-xl p-4 w-80">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-bold text-lg text-zinc-900">Ajouter un panneau</h2>
            <button
              onClick={() => {
                setShowAddForm(false);
                setClickedLocation(null);
              }}
              className="text-zinc-400 hover:text-zinc-600 text-xl"
            >
              ×
            </button>
          </div>

          <form onSubmit={handleAddBillboard} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Nom
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-zinc-900"
                placeholder="Nom du panneau"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Latitude
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={formData.lat}
                  onChange={(e) => setFormData({ ...formData, lat: e.target.value })}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-zinc-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Longitude
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={formData.lng}
                  onChange={(e) => setFormData({ ...formData, lng: e.target.value })}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-zinc-900 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Orientation (0-360°)
              </label>
              <input
                type="number"
                min="0"
                max="360"
                value={formData.facing_azimuth}
                onChange={(e) => setFormData({ ...formData, facing_azimuth: e.target.value })}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-zinc-900"
                placeholder="0 = Nord, 90 = Est, etc."
              />
              <p className="text-xs text-zinc-500 mt-1">
                Direction vers laquelle le panneau fait face
              </p>
            </div>

            <button
              type="submit"
              className="w-full px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium"
            >
              Ajouter
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
