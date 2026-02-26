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
