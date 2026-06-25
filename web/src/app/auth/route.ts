import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifySdmMac } from '@/lib/crypto';
import { encryptSession } from '@/lib/session';

export const runtime = 'nodejs';

// エラー画面へのリダイレクトヘルパー
function redirectToError(request: NextRequest, message: string) {
  const url = new URL('/auth-error', request.url);
  url.searchParams.set('reason', message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const uid = searchParams.get('uid');
  const ctr = searchParams.get('ctr');
  const mac = searchParams.get('mac');
  
  const tableIdParam = searchParams.get('table_id');
  const tokenParam = searchParams.get('token');

  // Supabase 管理者クライアントの初期化
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('Server error: SUPABASE_URL or SUPABASE_SECRET_KEY is not defined.');
    return redirectToError(request, 'サーバー設定エラーが発生しました。店員にお知らせください。');
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey);

  let finalTableId = '';
  let finalCtr = 0;
  let finalUid = '';

  try {
    if (uid && ctr && mac) {
      // --- A. NFC タグ検証フロー ---
      if (uid.length !== 14 || ctr.length !== 6 || mac.length !== 16) {
        return redirectToError(request, '無効なNFCパラメータ形式です。');
      }

      const masterKey = process.env.MASTER_KEY;
      if (!masterKey) {
        console.error('Server error: MASTER_KEY is not defined.');
        return redirectToError(request, 'サーバー暗号キーが設定されていません。');
      }

      const ctrValue = parseInt(ctr, 16);
      if (isNaN(ctrValue)) {
        return redirectToError(request, 'カウンター値の解析に失敗しました。');
      }

      // MAC署名の暗号検証
      const isMacValid = verifySdmMac(masterKey, uid, ctrValue, mac);
      if (!isMacValid) {
        return redirectToError(request, 'NFC認証に失敗しました。無効なMAC署名です。再度タップしてください。');
      }

      // DB からタグ情報を取得
      const { data: tag, error: tagError } = await supabaseAdmin
        .from('tags')
        .select('*')
        .eq('uid', uid.toUpperCase())
        .single();

      if (tagError || !tag) {
        return redirectToError(request, '店舗に登録されていないNFCタグです。店員にお知らせください。');
      }

      if (!tag.table_id) {
        return redirectToError(request, 'このタグは現在テーブルに紐付けられていません。店員にお知らせください。');
      }

      // テーブル状態の取得
      const { data: table, error: tableError } = await supabaseAdmin
        .from('tables')
        .select('status')
        .eq('table_id', tag.table_id)
        .single();

      if (tableError || !table) {
        return redirectToError(request, '紐付けられているテーブルが存在しません。店員にお知らせください。');
      }

      // 席状態 (occupied) のチェック
      if (table.status !== 'occupied') {
        return redirectToError(request, 'テーブルが案内中(利用開始)になっていません。お席の準備ができるまでしばらくお待ちください。');
      }

      // カウンターのしきい値判定 (退店後の注文防止)
      if (ctrValue <= tag.invalidated_ctr) {
        return redirectToError(request, 'このセッションURLは使用期限が切れています。新しいQRコードまたはNFCを読み込んでください。');
      }

      // カウンターの最大値をDB側で更新
      if (ctrValue > tag.current_max_ctr) {
        await supabaseAdmin
          .from('tags')
          .update({ current_max_ctr: ctrValue })
          .eq('uid', uid.toUpperCase());
      }

      finalTableId = tag.table_id;
      finalCtr = ctrValue;
      finalUid = uid.toUpperCase();

    } else if (tableIdParam && tokenParam) {
      // --- B. フォールバック QR 検証フロー ---
      const { data: table, error: tableError } = await supabaseAdmin
        .from('tables')
        .select('status, qr_token')
        .eq('table_id', tableIdParam)
        .single();

      if (tableError || !table) {
        return redirectToError(request, 'テーブルが見つかりません。');
      }

      // 席状態 & QRトークンの検証
      if (table.status !== 'occupied' || table.qr_token !== tokenParam) {
        return redirectToError(request, '無効または期限切れのQRコードです。お席の準備ができた状態で再度スキャンしてください。');
      }

      // QRセッション
      finalTableId = tableIdParam;
      finalCtr = 999999; 
      finalUid = `QR_${tokenParam}`;

    } else {
      return redirectToError(request, 'パラメータが不足しています。正しいURLにアクセスしてください。');
    }

    // --- C. セッションクッキー (JWT) の暗号生成 ---
    const sessionToken = await encryptSession({
      table_id: finalTableId,
      ctr: finalCtr,
      uid: finalUid
    });

    const isProd = process.env.NODE_ENV === 'production';
    const cookieOptions = [
      `session_token=${sessionToken}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      'Max-Age=86400', // 24時間有効
    ];
    if (isProd) {
      cookieOptions.push('Secure');
    }

    // /menu への一時リダイレクト応答
    return new NextResponse(null, {
      status: 307,
      headers: {
        'Location': '/menu',
        'Set-Cookie': cookieOptions.join('; ')
      }
    });

  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : 'Internal server error.';
    console.error('Auth endpoint error:', e);
    return redirectToError(request, `認証中にエラーが発生しました: ${errorMessage}`);
  }
}
