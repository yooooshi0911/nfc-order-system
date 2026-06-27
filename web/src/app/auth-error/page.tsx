import Link from 'next/link';

interface SearchParams {
  reason?: string;
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const reason = params.reason || 'アクセス認証に失敗しました。';

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
          backgroundColor: 'rgba(244, 63, 94, 0.1)',
          border: '1.5px solid var(--accent-rose)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          fontSize: '2.5rem',
          color: 'var(--accent-rose)',
          boxShadow: '0 4px 20px rgba(244, 63, 94, 0.2)'
        }}>
          ⚠️
        </div>
        
        <h1 className="text-gradient-gold" style={{
          fontSize: '1.5rem',
          fontWeight: 700,
          marginTop: '8px'
        }}>
          アクセスが拒否されました
        </h1>

        <div style={{
          background: 'var(--bg-tertiary)',
          padding: '16px 20px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--glass-border)',
          width: '100%',
          textAlign: 'left',
          fontSize: '0.9rem',
          lineHeight: '1.6',
          color: 'var(--text-secondary)'
        }}>
          <span style={{ fontWeight: 700, color: 'var(--accent-rose)', display: 'block', marginBottom: '4px' }}>
            エラー詳細:
          </span>
          {reason}
        </div>

        <p style={{
          color: 'var(--text-secondary)',
          fontSize: '0.9rem',
          lineHeight: '1.7',
          margin: '5px 0'
        }}>
          お席の準備が整うまでしばらくお待ちいただくか、店員までお声がけください。<br />
          再度ご利用いただく場合は、NFCタグまたはQRコードを読み込み直してください。
        </p>

        <div style={{
          width: '100%',
          height: '1px',
          backgroundColor: 'var(--glass-border)',
          margin: '8px 0'
        }} />
        
        <Link 
          href="/"
          className="btn btn-secondary"
          style={{ width: '100%', textDecoration: 'none', display: 'flex', justifyContent: 'center', minHeight: '44px' }}
        >
          トップに戻る
        </Link>
      </div>
    </div>
  );
}
