'use client';

import { useEffect } from 'react';

export default function CheckoutCompletePage() {
  useEffect(() => {
    // セッションクッキー session_token を削除する
    document.cookie = 'session_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict';
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
      padding: '20px',
      textAlign: 'center'
    }}>
      <div className="glass-panel animate-fade-in" style={{
        maxWidth: '500px',
        width: '100%',
        padding: '50px 40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '24px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-md)'
      }}>
        <div style={{
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          border: '1.5px solid var(--accent-emerald)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          fontSize: '2.5rem',
          color: 'var(--accent-emerald)',
          boxShadow: 'var(--shadow-emerald)'
        }}>
          ✓
        </div>
        
        <h1 className="text-gradient-gold" style={{
          fontSize: '1.6rem',
          fontWeight: 700,
          marginTop: '8px'
        }}>
          お会計が完了しました
        </h1>

        <p style={{
          color: 'var(--text-secondary)',
          fontSize: '0.95rem',
          lineHeight: '1.7',
          margin: '5px 0'
        }}>
          ご来店いただき誠にありがとうございました。<br />
          お会計処理が正常に終了し、今回の注文セッションは安全に終了いたしました。<br />
          またのご利用を心よりお待ち申し上げております。
        </p>

        <div style={{
          width: '100%',
          height: '1px',
          backgroundColor: 'var(--glass-border)',
          margin: '8px 0'
        }} />

        <p style={{
          color: 'var(--text-muted)',
          fontSize: '0.8rem',
        }}>
          ※この端末の注文セッションキーは安全に破棄されました。
        </p>
      </div>
    </div>
  );
}
