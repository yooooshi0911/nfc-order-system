import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decryptSession } from '@/lib/session';

export const runtime = 'nodejs';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY!;
  return createClient(supabaseUrl, supabaseSecretKey);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { table_id, items } = body;

    // 1. 基本パラメータ検証
    if (!table_id || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Invalid order request parameters.' },
        { status: 400 }
      );
    }

    // 2. クッキーからセッション(JWT)の取得と復号
    const cookieHeader = request.headers.get('cookie') || '';
    const token = cookieHeader.split(';')
      .map(c => c.trim())
      .find(c => c.startsWith('session_token='))
      ?.split('=')[1];

    if (!token) {
      return NextResponse.json(
        { error: 'セッションが見つかりません。もう一度NFCタグをタッチしてください。' },
        { status: 401 }
      );
    }

    const session = await decryptSession(token);
    if (!session) {
      return NextResponse.json(
        { error: '無効または期限切れのセッションです。' },
        { status: 401 }
      );
    }

    const { table_id: sessionTableId, ctr: sessionCtr, uid: sessionUid } = session;

    // テーブルIDがセッション情報と一致しているか検証
    if (sessionTableId !== table_id) {
      return NextResponse.json(
        { error: 'セッションのテーブル情報が一致しません。' },
        { status: 403 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 3. データベース状態の二重検証 (席の状態 & カウンターの鮮度チェック)
    if (sessionUid === 'QR_SESSION' || sessionUid.startsWith('QR_')) {
      // --- A. QRコードセッション ---
      const { data: table, error: tableError } = await supabaseAdmin
        .from('tables')
        .select('status, qr_token')
        .eq('table_id', table_id)
        .single();

      if (tableError || !table) {
        return NextResponse.json({ error: 'テーブルが見つかりません。' }, { status: 404 });
      }

      if (table.status !== 'occupied') {
        return NextResponse.json(
          { error: 'このテーブルは案内中(利用開始)になっていません。' },
          { status: 403 }
        );
      }

      // QRトークンの一致検証 (お会計後の古いセッションからの注文をブロック)
      if (sessionUid.startsWith('QR_')) {
        const clientQrToken = sessionUid.substring(3);
        if (table.qr_token !== clientQrToken) {
          return NextResponse.json(
            { error: 'お会計が完了したため、この注文セッションは終了しています。' },
            { status: 403 }
          );
        }
      }
    } else {
      // --- B. NFCタグセッション ---
      // 席の状態チェック
      const { data: table, error: tableError } = await supabaseAdmin
        .from('tables')
        .select('status')
        .eq('table_id', table_id)
        .single();

      if (tableError || !table || table.status !== 'occupied') {
        return NextResponse.json(
          { error: 'テーブルが案内中(利用開始)になっていません。' },
          { status: 403 }
        );
      }

      // カウンターの鮮度チェック
      const { data: tag, error: tagError } = await supabaseAdmin
        .from('tags')
        .select('invalidated_ctr')
        .eq('uid', sessionUid)
        .single();

      if (tagError || !tag) {
        return NextResponse.json({ error: 'タグ情報が見つかりません。' }, { status: 404 });
      }

      // カウンターしきい値判定 (退店後のリプレイ注文のブロック)
      if (sessionCtr <= tag.invalidated_ctr) {
        return NextResponse.json(
          { error: 'お会計が完了したため、この注文セッションは終了しています。' },
          { status: 403 }
        );
      }
    }

    // 4. 注文の挿入
    const { data: order, error: insertError } = await supabaseAdmin
      .from('orders')
      .insert({
        table_id,
        items,
        status: 'pending'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Failed to insert order:', insertError);
      return NextResponse.json(
        { error: '注文の登録に失敗しました。' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Order created successfully.',
      order
    });

  } catch (e) {
    console.error('Order creation API error:', e);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const table_id = searchParams.get('table_id');

    const supabaseAdmin = getSupabaseAdmin();

    let query = supabaseAdmin.from('orders').select('*').order('created_at', { ascending: false });

    if (table_id) {
      query = query.eq('table_id', table_id);
    }

    const { data: orders, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ orders });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
