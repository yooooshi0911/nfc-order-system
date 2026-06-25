import { withSupabase } from '@supabase/server';
import { type AppDatabase } from '@/lib/supabase-server';
import crypto from 'crypto';

export const POST = withSupabase<AppDatabase>({ auth: 'none' }, async (request, ctx) => {
  try {
    const body = await request.json();
    const { table_id } = body;

    if (!table_id) {
      return Response.json(
        { error: 'Missing table_id' },
        { status: 400 }
      );
    }

    const { supabaseAdmin } = ctx;

    // 1. テーブルが既に利用中か確認
    const { data: table, error: tableError } = await supabaseAdmin
      .from('tables')
      .select('status')
      .eq('table_id', table_id)
      .single();

    if (tableError || !table) {
      return Response.json(
        { error: `Table ${table_id} not found.` },
        { status: 404 }
      );
    }

    if (table.status === 'occupied') {
      return Response.json(
        { error: `Table ${table_id} is already occupied.` },
        { status: 400 }
      );
    }

    // 2. ワンタイムのフォールバックQR用トークンを生成
    // セキュアなランダム16バイトを16進数にしたもの
    const qrToken = crypto.randomBytes(16).toString('hex');

    // 3. テーブルのステータスを occupied (注文中) に更新し、qr_token を保存
    const { error: updateError } = await supabaseAdmin
      .from('tables')
      .update({
        status: 'occupied',
        qr_token: qrToken,
        updated_at: new Date().toISOString()
      })
      .eq('table_id', table_id);

    if (updateError) {
      console.error('Failed to update table status:', updateError);
      return Response.json(
        { error: 'Database update failed.' },
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
      message: `Table ${table_id} is now occupied.`,
      qr_token: qrToken
    });

  } catch (e) {
    console.error('Checkin handler error:', e);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
