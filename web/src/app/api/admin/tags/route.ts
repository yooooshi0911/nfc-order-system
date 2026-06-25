import { withSupabase } from '@supabase/server';
import { type AppDatabase } from '@/lib/supabase-server';

// タグ登録
export const POST = withSupabase<AppDatabase>({ auth: 'none' }, async (request, ctx) => {
  try {
    const { uid, serial_number, table_id } = await request.json();
    if (!uid || !serial_number) {
      return Response.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const { supabaseAdmin } = ctx;
    const { error } = await supabaseAdmin
      .from('tags')
      .insert({
        uid: uid.toUpperCase(),
        serial_number,
        table_id: table_id === 'none' ? null : table_id,
        invalidated_ctr: 0,
        current_max_ctr: 0
      });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (e: any) {
    return Response.json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
});

// タグの紐付け変更
export const PUT = withSupabase<AppDatabase>({ auth: 'none' }, async (request, ctx) => {
  try {
    const { uid, table_id } = await request.json();
    if (!uid) {
      return Response.json({ error: 'Missing uid' }, { status: 400 });
    }

    const { supabaseAdmin } = ctx;
    const { error } = await supabaseAdmin
      .from('tags')
      .update({ table_id: table_id === 'none' ? null : table_id })
      .eq('uid', uid);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (e: any) {
    return Response.json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
});

// タグの削除 (登録解除)
export const DELETE = withSupabase<AppDatabase>({ auth: 'none' }, async (request, ctx) => {
  try {
    const { searchParams } = new URL(request.url);
    const uid = searchParams.get('uid');
    if (!uid) {
      return Response.json({ error: 'Missing uid' }, { status: 400 });
    }

    const { supabaseAdmin } = ctx;
    const { error } = await supabaseAdmin
      .from('tags')
      .delete()
      .eq('uid', uid);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (e: any) {
    return Response.json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
});
