// scripts/seed.ts - Seed billboards from CSV data
import { dbOperations } from '../src/lib/db';
import fs from 'fs';
import path from 'path';

// Path to CSV file
const csvPath = path.join(__dirname, '../src/data/pige_orange_ci.csv');

// Parse CSV content
function parseCSV(content: string): Array<Record<string, string>> {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  // Remove BOM if present and parse header
  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const headers = parseCSVLine(headerLine);

  const records: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header.replace(/"/g, '').trim()] = values[index].replace(/"/g, '').trim();
      });
      records.push(record);
    }
  }

  return records;
}

// Parse a single CSV line (handles quoted values with commas)
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result;
}

// Main seed function
async function seed() {
  console.log('Reading CSV data from:', csvPath);

  // Read CSV file
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parseCSV(csvContent);

  console.log(`Found ${records.length} records in CSV\n`);

  // Delete existing billboards
  const existing = dbOperations.getAll();
  for (const bb of existing) {
    dbOperations.delete(bb.id);
  }
  console.log(`${existing.length} existing billboards deleted.\n`);

  // Track unique locations to avoid duplicates (same lat/lng)
  const uniqueLocations = new Map<string, boolean>();
  let created = 0;
  let skipped = 0;

  for (const record of records) {
    const lat = parseFloat(record['Latitude']);
    const lng = parseFloat(record['Longitude']);
    const name = record['Emplacement'];

    // Skip invalid coordinates
    if (isNaN(lat) || isNaN(lng) || !name) {
      skipped++;
      continue;
    }

    // Create unique key for location
    const locationKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;

    // Skip duplicates
    if (uniqueLocations.has(locationKey)) {
      skipped++;
      continue;
    }
    uniqueLocations.set(locationKey, true);

    // Create billboard
    const billboard = dbOperations.create({
      name: name,
      lat: lat,
      lng: lng
    });

    created++;

    // Show progress every 100 records
    if (created % 100 === 0) {
      console.log(`Created ${created} billboards...`);
    }
  }

  console.log(`\n✓ Created ${created} billboards from CSV data`);
  console.log(`✗ Skipped ${skipped} records (duplicates or invalid data)`);
  console.log('\nRun "npm run dev" and click "Actualiser tout" to fetch traffic data.');
}

seed().catch(console.error);
