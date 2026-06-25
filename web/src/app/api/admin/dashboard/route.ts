import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey);

  try {
    // テーブル一覧取得
    const { data: tables, error: tablesError } = await supabaseAdmin
      .from('tables')
      .select('*')
      .order('table_id', { ascending: true });

    if (tablesError) throw tablesError;

    // タグ一覧取得
    const { data: tags, error: tagsError } = await supabaseAdmin
      .from('tags')
      .select('*')
      .order('serial_number', { ascending: true });

    if (tagsError) throw tagsError;

    // 未完了の注文取得
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .select('*')
      .in('status', ['pending', 'served'])
      .order('created_at', { ascending: false });

    if (ordersError) throw ordersError;

    return NextResponse.json({
      success: true,
      tables: tables || [],
      tags: tags || [],
      orders: orders || []
    });

  } catch (error: any) {
    console.error('Error fetching dashboard data:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
