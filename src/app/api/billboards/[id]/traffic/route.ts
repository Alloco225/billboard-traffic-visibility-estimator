// app/api/billboards/[id]/traffic/route.ts - Get/refresh traffic for single billboard
import { NextRequest, NextResponse } from 'next/server';
import { dbOperations } from '@/lib/db';
import { refreshBillboardTraffic } from '@/lib/traffic-service';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const billboard = dbOperations.getById(parseInt(id));

    if (!billboard) {
      return NextResponse.json({ error: 'Billboard not found' }, { status: 404 });
    }

    // Return current traffic data
    return NextResponse.json({
      id: billboard.id,
      current_speed_kmh: billboard.current_speed_kmh,
      congestion_ratio: billboard.congestion_ratio,
      traffic_level: billboard.traffic_level,
      estimated_daily_traffic: billboard.estimated_daily_traffic,
      last_update: billboard.last_traffic_update
    });
  } catch (error) {
    console.error('Error fetching traffic:', error);
    return NextResponse.json(
      { error: 'Failed to fetch traffic data' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return NextResponse.json(
        { error: 'Google Maps API key not configured' },
        { status: 500 }
      );
    }

    const { id } = await params;
    const result = await refreshBillboardTraffic(parseInt(id));

    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error refreshing traffic:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to refresh traffic' },
      { status: 500 }
    );
  }
}
