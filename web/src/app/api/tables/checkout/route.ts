import { withSupabase } from '@supabase/server';
import { type AppDatabase } from '@/lib/supabase-server';

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

    // 1. テーブルの存在確認
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

    // 既に空席の場合は何もしないか、正常終了として扱う
    if (table.status === 'available') {
      return Response.json({
        success: true,
        message: `Table ${table_id} was already available.`
      });
    }

    // 2. PostgreSQL のアトミック関数を呼び出し
    // checkout_table(p_table_id) 内で tags, tables, orders テーブルの関連情報が一括更新される
    const { error: rpcError } = await supabaseAdmin.rpc('checkout_table', {
      p_table_id: table_id
    });

    if (rpcError) {
      console.error('RPC checkout_table failed:', rpcError);
      return Response.json(
        { error: 'Failed to process checkout transactions in DB.' },
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
      message: `Checkout successful for Table ${table_id}. Table is now available and past URL sessions are invalidated.`
    });

  } catch (e) {
    console.error('Checkout handler error:', e);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
