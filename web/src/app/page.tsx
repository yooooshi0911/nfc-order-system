'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isDemoLoading, setIsDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  // URL パラメータがある場合、自動的に /auth へ引き継いでリダイレクトする
  useEffect(() => {
    const uid = searchParams.get('uid');
    const ctr = searchParams.get('ctr');
    const mac = searchParams.get('mac');
    const tableId = searchParams.get('table_id');
    const token = searchParams.get('token');

    if ((uid && ctr && mac) || (tableId && token)) {
      console.log('Redirecting to /auth gateway with parameters...');
      const params = new URLSearchParams(searchParams.toString());
      router.replace(`/auth?${params.toString()}`);
    }
  }, [searchParams, router]);

  const startDemoOrder = async () => {
    setIsDemoLoading(true);
    setDemoError(null);
    try {
      // デモ用に01番テーブルをチェックイン（利用開始）状態にする
      const checkinRes = await fetch('/api/tables/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_id: '01' })
      });
      const checkinData = await checkinRes.json();

      if (!checkinRes.ok) {
        if (checkinData.error && checkinData.error.includes('already occupied')) {
          // 既に occupied の場合、強制的に一度チェックアウトさせて再チェックイン
          await fetch('/api/tables/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table_id: '01' })
          });
          
          // 再度チェックイン
          const retryRes = await fetch('/api/tables/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table_id: '01' })
          });
          const retryData = await retryRes.json();
          if (retryRes.ok) {
            router.push(`/auth?table_id=01&token=${retryData.qr_token}`);
            return;
          }
        }
        throw new Error(checkinData.error || 'デモ用テーブルの有効化に失敗しました。');
      }

      // 取得したワンタイム・トークンを付与して認証ゲートウェイ /auth へ遷移
      router.push(`/auth?table_id=01&token=${checkinData.qr_token}`);
    } catch (err: any) {
      console.error(err);
      setDemoError(err.message || '通信エラーが発生しました。先にWebサーバーやSupabaseが正常に起動しているか確認してください。');
      setIsDemoLoading(false);
    }
  };

  // パラメータがある場合はリダイレクト中なので、一時的にローディング画面を表示する
  const hasParams = (searchParams.get('uid') && searchParams.get('ctr') && searchParams.get('mac')) || 
                    (searchParams.get('table_id') && searchParams.get('token'));

  if (hasParams) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
        <div style={{ width: '40px', height: '40px', border: '3px solid rgba(212, 148, 58, 0.1)', borderTopColor: 'var(--accent-gold)', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '20px' }} />
        <h2 className="text-gradient-gold" style={{ fontSize: '1.25rem' }}>認証ゲートウェイ経由でリダイレクト中...</h2>
        <style jsx global>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="container animate-fade-in" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
      <main style={{ maxWidth: '800px', width: '100%', display: 'flex', flexDirection: 'column', gap: '30px' }}>
        
        {/* タイトル */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <h1 className="text-gradient-gold" style={{ fontSize: '2.5rem', fontWeight: 700, marginBottom: '10px' }}>
            NFC / QR Secure Order Portal
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', maxWidth: '600px', margin: '0 auto' }}>
            NTAG 424 DNA とクラウド（Supabase）を連動させ、クロスセッション・リプレイ攻撃（退店後の不正注文）を完全に防止するセキュアなオーダーシステムです。
          </p>
        </div>

        {/* メインナビゲーションパネル */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
          
          {/* 管理者画面 */}
          <div className="glass-panel" style={{ padding: '30px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '260px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                <span style={{ fontSize: '1.75rem' }}>🧑‍🍳</span>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--text-primary)' }}>店員用管理画面 (Admin)</h2>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '20px', lineHeight: '1.6' }}>
                テーブルの利用開始（チェックイン）、会計（チェックアウト）、リアルタイムな注文フィードの監視、ワンタイムQRコードの発行を行います。
              </p>
            </div>
            <Link href="/admin" className="btn btn-emerald" style={{ textDecoration: 'none', width: '100%', color: '#fff' }}>
              管理画面を開く
            </Link>
          </div>

          {/* デモ注文画面 */}
          <div className="glass-panel" style={{ padding: '30px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '260px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                <span style={{ fontSize: '1.75rem' }}>📱</span>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--text-primary)' }}>顧客用注文画面 (Customer)</h2>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '20px', lineHeight: '1.6' }}>
                本来は卓上NFCタグのタップ（または専用QRコードのスキャン）でアクセスする画面です。このポータルからワンクリックでデモ卓を有効化して、注文画面をお試しいただけます。
              </p>
              {demoError && (
                <div style={{ color: 'var(--accent-rose)', fontSize: '0.85rem', marginBottom: '15px', padding: '10px', background: 'rgba(244, 63, 94, 0.1)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(244, 63, 94, 0.2)' }}>
                  ⚠️ {demoError}
                </div>
              )}
            </div>
            <button 
              className="btn btn-primary" 
              onClick={startDemoOrder}
              disabled={isDemoLoading}
              style={{ width: '100%' }}
            >
              {isDemoLoading ? 'デモ卓を準備中...' : 'デモ用注文画面をお試し (01番卓)'}
            </button>
          </div>

        </div>

        {/* システム概要のフロー説明 */}
        <div className="glass-panel" style={{ padding: '25px', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
          <h3 style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            🛡️ セキュリティ動作の体験方法
          </h3>
          <ol style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li>
              <strong>管理画面</strong>を別タブで開き、01番テーブルが「空席」になっていることを確認します。
            </li>
            <li>
              右側の<strong>「デモ用注文画面をお試し」</strong>ボタンを押し、注文画面に入ります（自動的に01番テーブルが「利用中」になり、Cookieがセットされます）。
            </li>
            <li>
              ビールや唐揚げをカートに入れて<strong>「注文」</strong>します。管理画面の「注文フィード」にリアルタイムで反映されます。
            </li>
            <li>
              管理画面で01番テーブルの<strong>「会計完了」</strong>ボタンを押します。
            </li>
            <li>
              注文画面のブラウザに戻りリロードすると、セッションが自動的に無効化され、エラーではなく<strong>「お会計完了画面 (Checkout Complete)」</strong>へ自動遷移されることを確認できます！
            </li>
          </ol>
        </div>

      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
        <div style={{ width: '40px', height: '40px', border: '3px solid rgba(212, 148, 58, 0.1)', borderTopColor: 'var(--accent-gold)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}
