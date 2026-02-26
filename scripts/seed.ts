// scripts/seed.ts - Panneaux publicitaires à Abidjan sur les axes majeurs
import { dbOperations } from '../src/lib/db';

// Supprimer les panneaux existants
const existing = dbOperations.getAll();
for (const bb of existing) {
  dbOperations.delete(bb.id);
}
console.log(`${existing.length} panneaux existants supprimés.\n`);

// Panneaux sur les grands axes routiers d'Abidjan
const abidjanBillboards = [
  // Boulevard VGE (Valéry Giscard d'Estaing) - Axe principal Plateau-Cocody
  {
    name: 'Bd VGE - Carrefour Indénié',
    lat: 5.3289,
    lng: -3.9847,
    facing_azimuth: 270  // Face à l'ouest (trafic venant de Cocody)
  },

  // Pont Charles de Gaulle - Connexion Plateau-Treichville
  {
    name: 'Pont de Gaulle - Entrée Plateau',
    lat: 5.3178,
    lng: -4.0194,
    facing_azimuth: 180  // Face au sud (trafic venant de Treichville)
  },

  // Boulevard Lagunaire - Cocody
  {
    name: 'Bd Lagunaire - Cocody Ambassades',
    lat: 5.3230,
    lng: -3.9720,
    facing_azimuth: 90  // Face à l'est
  },

  // Autoroute A1 (Autoroute du Nord) - Très fréquentée
  {
    name: 'Autoroute A1 - Sortie Adjamé',
    lat: 5.3520,
    lng: -4.0180,
    facing_azimuth: 0  // Face au nord (trafic montant)
  },

  // Boulevard de Marseille - Marcory (Zone commerciale)
  {
    name: 'Bd de Marseille - Zone 4',
    lat: 5.3055,
    lng: -3.9780,
    facing_azimuth: 45  // Face nord-est
  },

  // Carrefour Akwaba - Point névralgique
  {
    name: 'Carrefour Akwaba - Marcory',
    lat: 5.2985,
    lng: -3.9850,
    facing_azimuth: 315  // Face nord-ouest
  },

  // Boulevard François Mitterrand - Cocody St Jean
  {
    name: 'Bd Mitterrand - Cocody St Jean',
    lat: 5.3480,
    lng: -3.9650,
    facing_azimuth: 180  // Face au sud
  },

  // Route de Bingerville - Sortie Abidjan Est
  {
    name: 'Route de Bingerville - Riviera 2',
    lat: 5.3550,
    lng: -3.9380,
    facing_azimuth: 270  // Face à l'ouest (trafic entrant)
  },
];

console.log('Création des panneaux sur les axes majeurs d\'Abidjan...\n');

for (const billboard of abidjanBillboards) {
  const created = dbOperations.create(billboard);
  console.log(`✓ ${created.name}`);
  console.log(`  Position: ${billboard.lat}, ${billboard.lng} | Orientation: ${billboard.facing_azimuth}°\n`);
}

console.log(`Terminé! ${abidjanBillboards.length} panneaux créés.`);
console.log('\nLancez "npm run dev" et cliquez sur "Actualiser tout" pour obtenir les données de trafic.');
