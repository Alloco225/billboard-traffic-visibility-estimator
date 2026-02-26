// app/api/traffic/refresh-all/route.ts - Refresh traffic for all billboards
import { NextResponse } from 'next/server';
import { refreshAllTraffic } from '@/lib/traffic-service';

export async function POST() {
  try {
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return NextResponse.json(
        { error: 'Google Maps API key not configured' },
        { status: 500 }
      );
    }

    const results = await refreshAllTraffic();

    const successful = results.filter(r => !r.error).length;
    const failed = results.filter(r => r.error).length;

    return NextResponse.json({
      status: 'completed',
      total: results.length,
      successful,
      failed,
      results
    });
  } catch (error) {
    console.error('Refresh all error:', error);
    return NextResponse.json(
      { error: 'Failed to refresh traffic data' },
      { status: 500 }
    );
  }
}
