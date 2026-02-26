// app/api/billboards/route.ts - CRUD for billboards
import { NextRequest, NextResponse } from 'next/server';
import { dbOperations } from '@/lib/db';
import { snapToRoad } from '@/lib/traffic-service';

export async function GET() {
  try {
    const billboards = dbOperations.getAll();
    return NextResponse.json(billboards);
  } catch (error) {
    console.error('Error fetching billboards:', error);
    return NextResponse.json(
      { error: 'Failed to fetch billboards' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.name || body.lat == null || body.lng == null) {
      return NextResponse.json(
        { error: 'Missing required fields: name, lat, lng' },
        { status: 400 }
      );
    }

    // Create billboard
    const billboard = dbOperations.create({
      name: body.name,
      lat: parseFloat(body.lat),
      lng: parseFloat(body.lng),
      facing_azimuth: body.facing_azimuth ? parseFloat(body.facing_azimuth) : undefined
    });

    // Optionally snap to road immediately
    if (process.env.GOOGLE_MAPS_API_KEY) {
      const snapData = await snapToRoad(billboard);
      if (snapData) {
        dbOperations.updateSnapped(billboard.id, snapData);
      }
    }

    // Return fresh data
    const created = dbOperations.getById(billboard.id);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Error creating billboard:', error);
    return NextResponse.json(
      { error: 'Failed to create billboard' },
      { status: 500 }
    );
  }
}
