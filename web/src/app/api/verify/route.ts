import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifySdmMac } from '@/lib/crypto';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const uid = searchParams.get('uid');
  const ctr = searchParams.get('ctr');
  const mac = searchParams.get('mac');

  // 1. パラメータの存在チェック
  if (!uid || !ctr || !mac) {
    return NextResponse.json(
      { error: 'Missing required parameters: uid, ctr, and mac are required.' },
      { status: 400 }
    );
  }

  // UID は14桁、CTR は6桁、MAC は16桁の16進数であることを簡易検証
  if (uid.length !== 14 || ctr.length !== 6 || mac.length !== 16) {
    return NextResponse.json(
      { error: 'Invalid parameter formats.' },
      { status: 400 }
    );
  }

  const masterKey = process.env.MASTER_KEY;
  if (!masterKey) {
    console.error('Server error: MASTER_KEY is not defined in environment variables.');
    return NextResponse.json(
      { error: 'Server configuration error.' },
      { status: 500 }
    );
  }

  // カウンター値を10進数の整数に変換
  const ctrValue = parseInt(ctr, 16);
  if (isNaN(ctrValue)) {
    return NextResponse.json(
      { error: 'Invalid counter format.' },
      { status: 400 }
    );
  }

  // 2. AES-128-CMAC 暗号検証
  const isMacValid = verifySdmMac(masterKey, uid, ctrValue, mac);
  if (!isMacValid) {
    return NextResponse.json(
      { error: 'Forbidden: Invalid MAC signature. Code verification failed.' },
      { status: 403 }
    );
  }

  // Supabase 管理者クライアントの初期化
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey);

  // 3. tags テーブルからタグ情報を検索
  const { data: tag, error: tagError } = await supabaseAdmin
    .from('tags')
    .select('*')
    .eq('uid', uid.toUpperCase())
    .single();

  if (tagError || !tag) {
    return NextResponse.json(
      { error: 'Not Found: Tag is not registered in this store.' },
      { status: 404 }
    );
  }

  const { table_id, invalidated_ctr, current_max_ctr } = tag;

  if (!table_id) {
    return NextResponse.json(
      { error: 'Forbidden: This tag is not associated with any active table.' },
      { status: 403 }
    );
  }

  // 4. tables テーブルからテーブル状態を確認
  const { data: table, error: tableError } = await supabaseAdmin
    .from('tables')
    .select('status')
    .eq('table_id', table_id)
    .single();

  if (tableError || !table) {
    return NextResponse.json(
      { error: 'Not Found: Associated table does not exist.' },
      { status: 404 }
    );
  }

  // テーブル状態が occupied (注文中) か確認
  if (table.status !== 'occupied') {
    return NextResponse.json(
      { error: 'Forbidden: Table is not occupied. Please contact store clerk.' },
      { status: 403 }
    );
  }

  // 5. セッション検証 (カウンターしきい値判定)
  if (ctrValue <= invalidated_ctr) {
    return NextResponse.json(
      { error: 'Forbidden: This URL session has expired (already checked out).' },
      { status: 403 }
    );
  }

  // 6. カウンターの最大値を更新
  if (ctrValue > current_max_ctr) {
    const { error: updateError } = await supabaseAdmin
      .from('tags')
      .update({ current_max_ctr: ctrValue })
      .eq('uid', uid.toUpperCase());

    if (updateError) {
      console.error('Failed to update current_max_ctr:', updateError);
    }
  }

  // 全条件クリア
  return NextResponse.json({
    success: true,
    table_id: table_id,
    session_type: 'nfc',
    message: 'NFC Verification successful.'
  });
}
