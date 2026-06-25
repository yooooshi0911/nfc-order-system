import { withSupabase } from '@supabase/server';
import { type AppDatabase } from '@/lib/supabase-server';

// テーブル作成
export const POST = withSupabase<AppDatabase>({ auth: 'none' }, async (request, ctx) => {
  try {
    const { table_id } = await request.json();
    if (!table_id) {
      return Response.json({ error: 'Missing table_id' }, { status: 400 });
    }

    const { supabaseAdmin } = ctx;
    const { error } = await supabaseAdmin
      .from('tables')
      .insert({ table_id, status: 'available' });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (e: any) {
    return Response.json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
});

// テーブル削除
export const DELETE = withSupabase<AppDatabase>({ auth: 'none' }, async (request, ctx) => {
  try {
    const { searchParams } = new URL(request.url);
    const table_id = searchParams.get('table_id');
    if (!table_id) {
      return Response.json({ error: 'Missing table_id' }, { status: 400 });
    }

    const { supabaseAdmin } = ctx;
    
    // 現在利用中のテーブルは削除できないように安全弁を設ける
    const { data: table } = await supabaseAdmin.from('tables').select('status').eq('table_id', table_id).single();
    if (table && table.status === 'occupied') {
      return Response.json({ error: '利用中のテーブルは削除できません。先に会計を完了させてください。' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('tables')
      .delete()
      .eq('table_id', table_id);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (e: any) {
    return Response.json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
});
