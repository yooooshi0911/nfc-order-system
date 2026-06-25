import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const config = {
  matcher: ['/menu'],
};

export async function proxy(request: NextRequest) {
  // JWTクッキーの簡易チェック（Edge Runtime対応の軽量版）
  const token = request.cookies.get('session_token')?.value;

  if (!token) {
    console.log('[Proxy] No session token found. Redirecting to /checkout-complete');
    return NextResponse.redirect(new URL('/checkout-complete', request.url));
  }

  // セッションが存在する場合は続行する
  // 詳細な検証 (DB確認・JWT復号) は各 API ルートのサーバーサイドで行う
  return NextResponse.next();
}
