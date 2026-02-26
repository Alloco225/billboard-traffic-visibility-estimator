// lib/db.ts - SQLite database connection and schema
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'billboards.db');

// Lazy initialization to avoid issues during build
let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(dbPath);
    // Enable WAL mode for better concurrency
    _db.pragma('journal_mode = WAL');
    _db.pragma('busy_timeout = 5000');

    // Create tables
    _db.exec(`
      CREATE TABLE IF NOT EXISTS billboards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        snapped_lat REAL,
        snapped_lng REAL,
        road_bearing REAL,
        facing_azimuth REAL,
        segment_length_m REAL DEFAULT 300,
        posted_speed_limit_kmh INTEGER,
        current_speed_kmh REAL,
        congestion_ratio REAL,
        traffic_level TEXT CHECK(traffic_level IN ('low', 'medium', 'heavy', 'jammed')),
        estimated_daily_traffic INTEGER,
        last_traffic_update TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_billboards_location ON billboards(lat, lng);
    `);
  }
  return _db;
}

export interface Billboard {
  id: number;
  name: string;
  lat: number;
  lng: number;
  snapped_lat: number | null;
  snapped_lng: number | null;
  road_bearing: number | null;
  facing_azimuth: number | null;
  segment_length_m: number;
  posted_speed_limit_kmh: number | null;
  current_speed_kmh: number | null;
  congestion_ratio: number | null;
  traffic_level: 'low' | 'medium' | 'heavy' | 'jammed' | null;
  estimated_daily_traffic: number | null;
  last_traffic_update: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateBillboardInput {
  name: string;
  lat: number;
  lng: number;
  facing_azimuth?: number;
}

export const dbOperations = {
  create(input: CreateBillboardInput): Billboard {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO billboards (name, lat, lng, facing_azimuth)
      VALUES (@name, @lat, @lng, @facing_azimuth)
    `);
    const result = stmt.run({
      name: input.name,
      lat: input.lat,
      lng: input.lng,
      facing_azimuth: input.facing_azimuth ?? null
    });
    return db.prepare('SELECT * FROM billboards WHERE id = ?').get(result.lastInsertRowid) as Billboard;
  },

  getAll(): Billboard[] {
    const db = getDb();
    return db.prepare('SELECT * FROM billboards ORDER BY created_at DESC').all() as Billboard[];
  },

  getById(id: number): Billboard | undefined {
    const db = getDb();
    return db.prepare('SELECT * FROM billboards WHERE id = ?').get(id) as Billboard | undefined;
  },

  updateTraffic(id: number, data: {
    current_speed_kmh: number | null;
    congestion_ratio: number | null;
    traffic_level: string | null;
    estimated_daily_traffic: number | null;
  }) {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE billboards SET
        current_speed_kmh = @current_speed_kmh,
        congestion_ratio = @congestion_ratio,
        traffic_level = @traffic_level,
        estimated_daily_traffic = @estimated_daily_traffic,
        last_traffic_update = datetime('now'),
        updated_at = datetime('now')
      WHERE id = @id
    `);
    return stmt.run({ id, ...data });
  },

  updateSnapped(id: number, data: {
    snapped_lat: number;
    snapped_lng: number;
    road_bearing: number;
    posted_speed_limit_kmh: number | null;
  }) {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE billboards SET
        snapped_lat = @snapped_lat,
        snapped_lng = @snapped_lng,
        road_bearing = @road_bearing,
        posted_speed_limit_kmh = @posted_speed_limit_kmh,
        updated_at = datetime('now')
      WHERE id = @id
    `);
    return stmt.run({ id, ...data });
  },

  delete(id: number) {
    const db = getDb();
    return db.prepare('DELETE FROM billboards WHERE id = ?').run(id);
  },

  update(id: number, data: {
    name?: string;
    lat?: number;
    lng?: number;
    facing_azimuth?: number | null;
  }) {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE billboards SET
        name = @name,
        lat = @lat,
        lng = @lng,
        facing_azimuth = @facing_azimuth,
        snapped_lat = NULL,
        snapped_lng = NULL,
        road_bearing = NULL,
        updated_at = datetime('now')
      WHERE id = @id
    `);
    return stmt.run({ id, ...data });
  }
};

export default getDb;
