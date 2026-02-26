// app/api/billboards/[id]/route.ts - Single billboard operations
import { NextRequest, NextResponse } from 'next/server';
import { dbOperations } from '@/lib/db';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const billboard = dbOperations.getById(parseInt(id));

    if (!billboard) {
      return NextResponse.json({ error: 'Billboard not found' }, { status: 404 });
    }

    return NextResponse.json(billboard);
  } catch (error) {
    console.error('Error fetching billboard:', error);
    return NextResponse.json(
      { error: 'Failed to fetch billboard' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const billboard = dbOperations.getById(parseInt(id));

    if (!billboard) {
      return NextResponse.json({ error: 'Billboard not found' }, { status: 404 });
    }

    dbOperations.delete(parseInt(id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting billboard:', error);
    return NextResponse.json(
      { error: 'Failed to delete billboard' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const billboardId = parseInt(id);
    const billboard = dbOperations.getById(billboardId);

    if (!billboard) {
      return NextResponse.json({ error: 'Billboard not found' }, { status: 404 });
    }

    const body = await request.json();

    // Update billboard with provided fields
    dbOperations.update(billboardId, {
      name: body.name ?? billboard.name,
      lat: body.lat ?? billboard.lat,
      lng: body.lng ?? billboard.lng,
      facing_azimuth: body.facing_azimuth ?? billboard.facing_azimuth,
    });

    // Return updated billboard
    const updated = dbOperations.getById(billboardId);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating billboard:', error);
    return NextResponse.json(
      { error: 'Failed to update billboard' },
      { status: 500 }
    );
  }
}
