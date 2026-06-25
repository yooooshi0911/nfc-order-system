import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { decryptSession } from '@/lib/session';
import { createClient } from '@supabase/supabase-js';
import MenuContent from './MenuContent';

export const dynamic = 'force-dynamic';

export default async function MenuPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;

  if (!sessionToken) {
    redirect('/checkout-complete');
  }

  const session = await decryptSession(sessionToken);

  if (!session) {
    redirect('/checkout-complete');
  }

  const { table_id, ctr, uid } = session;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('Server configuration error in /menu/page.tsx');
    redirect('/checkout-complete');
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey);

  // 1. テーブル状態の検証 (occupied であること)
  const { data: table, error: tableError } = await supabaseAdmin
    .from('tables')
    .select('status')
    .eq('table_id', table_id)
    .single();

  if (tableError || !table || table.status !== 'occupied') {
    redirect('/checkout-complete');
  }

  // 2. セッションの有効性検証
  if (uid.startsWith('QR_')) {
    const clientQrToken = uid.substring(3); // 'QR_' 以降の部分
    const { data: tableData, error: tableError2 } = await supabaseAdmin
      .from('tables')
      .select('qr_token')
      .eq('table_id', table_id)
      .single();

    if (tableError2 || !tableData || tableData.qr_token !== clientQrToken) {
      redirect('/checkout-complete');
    }
  } else if (uid !== 'QR_SESSION') {
    // NFCタグセッションの場合、お会計（退店時）に無効化されたカウンター以下でないか検証
    const { data: tag, error: tagError } = await supabaseAdmin
      .from('tags')
      .select('invalidated_ctr')
      .eq('uid', uid)
      .single();

    if (tagError || !tag || ctr <= tag.invalidated_ctr) {
      redirect('/checkout-complete');
    }
  }

  const sessionType = uid === 'QR_SESSION' ? 'qr' : 'nfc';

  return (
    <MenuContent 
      table_id={table_id} 
      session_type={sessionType}
    />
  );
}
