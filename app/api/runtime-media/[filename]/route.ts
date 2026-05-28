import { NextRequest, NextResponse } from 'next/server';
import { readPublicRuntimeMediaFile, sanitizeRuntimeMediaFilename } from '@/lib/media-storage';

export const dynamic = 'force-dynamic';

function buildEtag(filename: string, size: number): string {
  return `"runtime-${encodeURIComponent(filename)}-${size}"`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const safeFilename = sanitizeRuntimeMediaFilename(filename);
  const file = await readPublicRuntimeMediaFile(safeFilename);

  if (!file) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const etag = buildEtag(file.filename, file.buffer.length);
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch.split(',').some((value) => value.trim() === etag || value.trim() === '*')) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': 'public, max-age=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  return new NextResponse(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      'Content-Type': file.mimeType,
      'Content-Length': String(file.buffer.length),
      'Cache-Control': 'public, max-age=86400, immutable',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="${file.filename}"`,
    },
  });
}
