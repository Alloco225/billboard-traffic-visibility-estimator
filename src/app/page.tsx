'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  Polygon,
  InfoWindow,
  TrafficLayer,
  Polyline,
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

// Couleurs des panneaux
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

const DEFAULT_CENTER = { lat: 5.3484, lng: -4.0085 };

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

// Calculer le point de la poignée de rotation
function getRotationHandlePosition(
  center: { lat: number; lng: number },
  azimuth: number,
  distance: number = 80
): google.maps.LatLngLiteral {
  const earthRadius = 6371000;
  const angleRad = (azimuth * Math.PI) / 180;

  const dLat = (distance / earthRadius) * Math.cos(angleRad);
  const dLng = (distance / earthRadius) * Math.sin(angleRad) / Math.cos((center.lat * Math.PI) / 180);

  return {
    lat: center.lat + (dLat * 180) / Math.PI,
    lng: center.lng + (dLng * 180) / Math.PI,
  };
}

// Calculer l'azimut entre deux points
function calculateAzimuth(from: google.maps.LatLngLiteral, to: google.maps.LatLngLiteral): number {
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  let azimuth = Math.atan2(y, x) * 180 / Math.PI;
  return (azimuth + 360) % 360;
}

export default function Home() {
  const [billboards, setBillboards] = useState<Billboard[]>([]);
  const [selectedBillboard, setSelectedBillboard] = useState<Billboard | null>(null);
  const [editingBillboard, setEditingBillboard] = useState<Billboard | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [refreshing, setRefreshing] = useState<number | null>(null);
  const [showTrafficLayer, setShowTrafficLayer] = useState(true);
  const [rotatingBillboardId, setRotatingBillboardId] = useState<number | null>(null);

  // Formulaire pour création/édition
  const [formData, setFormData] = useState({
    name: '',
    lat: '',
    lng: '',
    facing_azimuth: '0'
  });

  const mapRef = useRef<google.maps.Map | null>(null);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
    libraries: ['places'],
  });

  // Charger les panneaux
  const fetchBillboards = useCallback(async (centerOnFirst = false) => {
    try {
      const res = await fetch('/api/billboards');
      const data = await res.json();
      setBillboards(data);

      if (centerOnFirst && data.length > 0 && mapRef.current) {
        const firstBb = data[0];
        mapRef.current.panTo({
          lat: firstBb.snapped_lat ?? firstBb.lat,
          lng: firstBb.snapped_lng ?? firstBb.lng,
        });
      }
    } catch (err) {
      console.error('Erreur lors du chargement:', err);
    }
  }, []);

  useEffect(() => {
    fetchBillboards(true);
  }, [fetchBillboards]);

  const handleMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  // Clic sur la carte en mode édition
  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (!isEditMode || !e.latLng) return;

    const lat = e.latLng.lat();
    const lng = e.latLng.lng();

    setFormData({
      name: '',
      lat: lat.toFixed(6),
      lng: lng.toFixed(6),
      facing_azimuth: '0'
    });
    setIsCreating(true);
    setEditingBillboard(null);
    setSelectedBillboard(null);
  }, [isEditMode]);

  // Créer un panneau
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const res = await fetch('/api/billboards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          lat: parseFloat(formData.lat),
          lng: parseFloat(formData.lng),
          facing_azimuth: parseFloat(formData.facing_azimuth) || 0,
        }),
      });

      if (res.ok) {
        setFormData({ name: '', lat: '', lng: '', facing_azimuth: '0' });
        setIsCreating(false);
        await fetchBillboards(false);
      }
    } catch (err) {
      console.error('Erreur lors de la création:', err);
    }
  };

  // Mettre à jour un panneau
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBillboard) return;

    try {
      const res = await fetch(`/api/billboards/${editingBillboard.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          lat: parseFloat(formData.lat),
          lng: parseFloat(formData.lng),
          facing_azimuth: parseFloat(formData.facing_azimuth) || 0,
        }),
      });

      if (res.ok) {
        setEditingBillboard(null);
        setFormData({ name: '', lat: '', lng: '', facing_azimuth: '0' });
        await fetchBillboards(false);
      }
    } catch (err) {
      console.error('Erreur lors de la mise à jour:', err);
    }
  };

  // Éditer un panneau existant
  const startEditing = (billboard: Billboard) => {
    setEditingBillboard(billboard);
    setIsCreating(false);
    setSelectedBillboard(null);
    setFormData({
      name: billboard.name,
      lat: billboard.lat.toString(),
      lng: billboard.lng.toString(),
      facing_azimuth: (billboard.facing_azimuth ?? 0).toString(),
    });
  };

  // Drag du marqueur
  const handleMarkerDrag = async (billboard: Billboard, e: google.maps.MapMouseEvent) => {
    if (!e.latLng || !isEditMode) return;

    const newLat = e.latLng.lat();
    const newLng = e.latLng.lng();

    try {
      await fetch(`/api/billboards/${billboard.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: newLat,
          lng: newLng,
        }),
      });
      await fetchBillboards(false);
    } catch (err) {
      console.error('Erreur lors du déplacement:', err);
    }
  };

  // Drag de la poignée de rotation
  const handleRotationDrag = async (billboard: Billboard, e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;

    const center = {
      lat: billboard.snapped_lat ?? billboard.lat,
      lng: billboard.snapped_lng ?? billboard.lng,
    };

    const newAzimuth = calculateAzimuth(center, {
      lat: e.latLng.lat(),
      lng: e.latLng.lng(),
    });

    // Mise à jour optimiste locale
    setBillboards(prev => prev.map(bb =>
      bb.id === billboard.id ? { ...bb, facing_azimuth: newAzimuth } : bb
    ));
  };

  const handleRotationDragEnd = async (billboard: Billboard, e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;

    const center = {
      lat: billboard.snapped_lat ?? billboard.lat,
      lng: billboard.snapped_lng ?? billboard.lng,
    };

    const newAzimuth = calculateAzimuth(center, {
      lat: e.latLng.lat(),
      lng: e.latLng.lng(),
    });

    setRotatingBillboardId(null);

    try {
      await fetch(`/api/billboards/${billboard.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facing_azimuth: Math.round(newAzimuth) }),
      });
      await fetchBillboards(false);
    } catch (err) {
      console.error('Erreur lors de la rotation:', err);
    }
  };

  // Supprimer un panneau
  const handleDelete = async (id: number) => {
    if (!confirm('Supprimer ce panneau ?')) return;

    try {
      await fetch(`/api/billboards/${id}`, { method: 'DELETE' });
      setSelectedBillboard(null);
      setEditingBillboard(null);
      await fetchBillboards(false);
    } catch (err) {
      console.error('Erreur lors de la suppression:', err);
    }
  };

  // Actualiser le trafic
  const handleRefreshTraffic = async (id: number) => {
    setRefreshing(id);
    try {
      await fetch(`/api/billboards/${id}/traffic`, { method: 'POST' });
      await fetchBillboards(false);
    } catch (err) {
      console.error('Erreur:', err);
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
      console.error('Erreur:', err);
    } finally {
      setRefreshing(null);
    }
  };

  const goToBillboard = useCallback((bb: Billboard) => {
    if (isEditMode) {
      startEditing(bb);
    } else {
      setSelectedBillboard(bb);
    }
    if (mapRef.current) {
      mapRef.current.panTo({
        lat: bb.snapped_lat ?? bb.lat,
        lng: bb.snapped_lng ?? bb.lng,
      });
    }
  }, [isEditMode]);

  const mapOptions = useMemo(() => ({
    disableDefaultUI: false,
    zoomControl: true,
    streetViewControl: true,
    mapTypeControl: true,
    fullscreenControl: true,
    draggableCursor: isEditMode ? 'crosshair' : undefined,
    styles: [
      {
        featureType: 'poi',
        elementType: 'labels',
        stylers: [{ visibility: 'off' }],
      },
    ],
  }), [isEditMode]);

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-900 text-white">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Erreur de chargement</h1>
          <p>Vérifiez la configuration de votre clé API Google Maps.</p>
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
      {/* Bandeau mode édition */}
      {isEditMode && (
        <div className="absolute top-0 left-0 right-0 z-20 bg-amber-500 text-white py-2 px-4 text-center font-medium shadow-lg">
          Mode Édition — Cliquez sur la carte pour ajouter un panneau, glissez les marqueurs pour les déplacer, glissez la poignée pour orienter
        </div>
      )}

      {/* Carte */}
      <GoogleMap
        mapContainerStyle={MAP_CONTAINER_STYLE}
        center={DEFAULT_CENTER}
        zoom={13}
        options={mapOptions}
        onClick={handleMapClick}
        onLoad={handleMapLoad}
      >
        {showTrafficLayer && <TrafficLayer />}

        {/* Panneaux */}
        {billboards.map((billboard) => {
          const position = {
            lat: billboard.snapped_lat ?? billboard.lat,
            lng: billboard.snapped_lng ?? billboard.lng,
          };

          const facingAzimuth = billboard.facing_azimuth ?? billboard.road_bearing ?? 0;
          const trafficColor = TRAFFIC_COLORS[billboard.traffic_level || 'low'];
          const isSelected = selectedBillboard?.id === billboard.id || editingBillboard?.id === billboard.id;

          return (
            <div key={billboard.id}>
              {/* Cône de visibilité */}
              {generateGradientCone(position, facingAzimuth, billboard.traffic_level).map(
                (cone, i) => (
                  <Polygon
                    key={`cone-${billboard.id}-${i}`}
                    paths={cone.points}
                    options={{
                      fillColor: isSelected ? '#f59e0b' : trafficColor.stroke,
                      fillOpacity: cone.opacity,
                      strokeColor: isSelected ? '#f59e0b' : trafficColor.stroke,
                      strokeOpacity: i === 0 ? 0.8 : 0,
                      strokeWeight: i === 0 ? 2 : 0,
                    }}
                  />
                )
              )}

              {/* Ligne de direction en mode édition */}
              {isEditMode && (
                <Polyline
                  path={[position, getRotationHandlePosition(position, facingAzimuth)]}
                  options={{
                    strokeColor: isSelected ? '#f59e0b' : '#6b7280',
                    strokeWeight: 2,
                    strokeOpacity: 0.8,
                  }}
                />
              )}

              {/* Marqueur principal */}
              <Marker
                position={position}
                draggable={isEditMode}
                onDragEnd={(e) => handleMarkerDrag(billboard, e)}
                onClick={() => {
                  if (isEditMode) {
                    startEditing(billboard);
                  } else {
                    setSelectedBillboard(billboard);
                  }
                }}
                icon={{
                  path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                  scale: 7,
                  rotation: facingAzimuth,
                  fillColor: isSelected ? '#f59e0b' : trafficColor.stroke,
                  fillOpacity: 1,
                  strokeColor: '#ffffff',
                  strokeWeight: 2,
                }}
                title={billboard.name}
                zIndex={isSelected ? 1000 : 1}
              />

              {/* Poignée de rotation en mode édition */}
              {isEditMode && (
                <Marker
                  position={getRotationHandlePosition(position, facingAzimuth)}
                  draggable={true}
                  onDragStart={() => setRotatingBillboardId(billboard.id)}
                  onDrag={(e) => handleRotationDrag(billboard, e)}
                  onDragEnd={(e) => handleRotationDragEnd(billboard, e)}
                  icon={{
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 8,
                    fillColor: isSelected ? '#f59e0b' : '#6b7280',
                    fillOpacity: 1,
                    strokeColor: '#ffffff',
                    strokeWeight: 2,
                  }}
                  title="Glissez pour orienter"
                  zIndex={isSelected ? 1001 : 2}
                />
              )}
            </div>
          );
        })}

        {/* InfoWindow en mode visualisation */}
        {selectedBillboard && !isEditMode && (
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

                <div className="text-xs text-zinc-500 mt-2">
                  {selectedBillboard.lat.toFixed(5)}, {selectedBillboard.lng.toFixed(5)}
                  {selectedBillboard.facing_azimuth != null && (
                    <span className="ml-2">Orientation: {Math.round(selectedBillboard.facing_azimuth)}°</span>
                  )}
                </div>

                {selectedBillboard.last_traffic_update && (
                  <div className="text-xs text-zinc-400">
                    Mis à jour: {new Date(selectedBillboard.last_traffic_update).toLocaleString('fr-FR')}
                  </div>
                )}

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
      <div className={`absolute ${isEditMode ? 'top-14' : 'top-4'} left-4 z-10 space-y-3`}>
        {/* En-tête */}
        <div className="bg-white/95 backdrop-blur rounded-lg shadow-lg p-4">
          <h1 className="font-bold text-lg text-zinc-900">Estimateur de Trafic</h1>
          <p className="text-xs text-zinc-500">
            {isEditMode ? 'Mode édition activé' : 'Panneaux publicitaires'}
          </p>
        </div>

        {/* Toggle mode édition */}
        <div className="bg-white/95 backdrop-blur rounded-lg shadow-lg p-3">
          <button
            onClick={() => {
              setIsEditMode(!isEditMode);
              setSelectedBillboard(null);
              setEditingBillboard(null);
              setIsCreating(false);
            }}
            className={`w-full px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              isEditMode
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300'
            }`}
          >
            {isEditMode ? '✓ Mode Édition' : '✏️ Activer l\'édition'}
          </button>
        </div>

        {/* Actions trafic (en mode visualisation) */}
        {!isEditMode && (
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
        )}

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
            {isEditMode && (
              <div className="flex items-center gap-2 text-xs border-t border-zinc-200 pt-1 mt-1">
                <div className="w-4 h-4 rounded bg-amber-500" />
                <span className="text-zinc-700">Sélectionné</span>
              </div>
            )}
          </div>
        </div>

        {/* Liste des panneaux */}
        {billboards.length > 0 && (
          <div className="bg-white/95 backdrop-blur rounded-lg shadow-lg p-3 max-h-[250px] overflow-y-auto">
            <div className="text-xs font-semibold text-zinc-700 mb-2">
              Panneaux ({billboards.length})
            </div>
            <div className="space-y-1">
              {billboards.map((bb) => (
                <button
                  key={bb.id}
                  onClick={() => goToBillboard(bb)}
                  className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 ${
                    editingBillboard?.id === bb.id
                      ? 'bg-amber-100 border border-amber-300'
                      : 'hover:bg-zinc-100'
                  }`}
                >
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: TRAFFIC_COLORS[bb.traffic_level || 'low'].stroke,
                    }}
                  />
                  <span className="truncate flex-1 text-zinc-900">{bb.name}</span>
                  {!isEditMode && bb.estimated_daily_traffic && (
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

      {/* Formulaire création/édition */}
      {isEditMode && (isCreating || editingBillboard) && (
        <div className={`absolute ${isEditMode ? 'top-14' : 'top-4'} right-4 z-10 bg-white rounded-lg shadow-xl p-4 w-80`}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-bold text-lg text-zinc-900">
              {editingBillboard ? 'Modifier le panneau' : 'Nouveau panneau'}
            </h2>
            <button
              onClick={() => {
                setIsCreating(false);
                setEditingBillboard(null);
                setFormData({ name: '', lat: '', lng: '', facing_azimuth: '0' });
              }}
              className="text-zinc-400 hover:text-zinc-600 text-xl"
            >
              ×
            </button>
          </div>

          <form onSubmit={editingBillboard ? handleUpdate : handleCreate} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Nom
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-zinc-900"
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
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-zinc-900 text-sm"
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
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-zinc-900 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Orientation (0-360°)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  max="360"
                  value={formData.facing_azimuth}
                  onChange={(e) => setFormData({ ...formData, facing_azimuth: e.target.value })}
                  className="flex-1 px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-zinc-900"
                />
                <div className="flex gap-1">
                  {[0, 90, 180, 270].map((angle) => (
                    <button
                      key={angle}
                      type="button"
                      onClick={() => setFormData({ ...formData, facing_azimuth: angle.toString() })}
                      className="px-2 py-2 bg-zinc-100 hover:bg-zinc-200 rounded text-xs text-zinc-700"
                      title={`${angle}° (${['N', 'E', 'S', 'O'][angle / 90]})`}
                    >
                      {['N', 'E', 'S', 'O'][angle / 90]}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                0° = Nord, 90° = Est, 180° = Sud, 270° = Ouest
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium"
              >
                {editingBillboard ? 'Enregistrer' : 'Créer'}
              </button>
              {editingBillboard && (
                <button
                  type="button"
                  onClick={() => handleDelete(editingBillboard.id)}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium"
                >
                  Supprimer
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
