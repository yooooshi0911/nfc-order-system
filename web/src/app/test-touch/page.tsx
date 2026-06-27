'use client';

import { useState, useRef, useEffect } from 'react';

interface LogEntry {
  id: number;
  time: string;
  pattern: string;
  eventName: string;
}

export default function TestTouchPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('No errors detected yet.');
  const logIdRef = useRef(0);
  const nativeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // クライアントサイドのJSが正常に実行されたかをアラートで確認
    alert('JavaScript is successfully running on your device!');

    // グローバルエラーキャッチ
    const errorHandler = (message: any, source: any, lineno: any, colno: any, error: any) => {
      setErrorMsg(`[ERROR] ${message} at ${source}:${lineno}:${colno}`);
      return false;
    };
    window.onerror = errorHandler;
    window.addEventListener('error', (e) => errorHandler(e.message, e.filename, e.lineno, e.colno, e.error));

    // ネイティブDOMイベントのアタッチ
    if (nativeBtnRef.current) {
      nativeBtnRef.current.addEventListener('click', () => {
        addLog('Z: Native DOM Event', 'native_click');
      });
      nativeBtnRef.current.addEventListener('touchstart', () => {
        addLog('Z: Native DOM Event', 'native_touchstart');
      });
    }

    return () => {
      window.onerror = null;
    };
  }, []);

  const addLog = (pattern: string, eventName: string, e?: any) => {
    if (e && e.preventDefault && eventName !== 'onTouchEnd') {
      if (eventName !== 'onTouchStart' && eventName !== 'onTouchEnd') {
        e.preventDefault();
      }
    }
    
    const now = new Date();
    const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    
    setLogs((prev) => [
      { id: logIdRef.current++, time: timeStr, pattern, eventName },
      ...prev
    ]);
  };

  const baseBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '60px',
    marginBottom: '10px',
    backgroundColor: '#3b82f6',
    color: '#fff',
    fontSize: '16px',
    fontWeight: 'bold',
    borderRadius: '8px',
    border: 'none',
    userSelect: 'none',
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#fff', minHeight: '100vh', color: '#000' }}>
      <h1 style={{ fontSize: '20px', marginBottom: '10px' }}>タッチイベント＆JS生存診断</h1>
      <p style={{ fontSize: '14px', marginBottom: '10px', color: '#666' }}>
        もし画面を開いたときに「JavaScript is successfully running...」というポップアップ（アラート）が出なかった場合、
        <strong>何らかの原因でプログラム自体がクラッシュして止まっています。</strong>
      </p>

      <div style={{ padding: '10px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '4px', marginBottom: '20px', fontSize: '12px', fontWeight: 'bold', wordBreak: 'break-all' }}>
        JSエラー監視: {errorMsg}
      </div>

      <div style={{ marginBottom: '30px' }}>
        <button 
          ref={nativeBtnRef}
          style={{ ...baseBtnStyle, backgroundColor: '#0f172a' }} 
        >
          Z: Reactを通さない純粋なHTMLボタン (Native Event)
        </button>

        <button 
          style={baseBtnStyle} 
          onClick={(e) => addLog('A: 標準 <button>', 'onClick', e)}
        >
          A: 標準の button 要素 (onClick)
        </button>

        <a 
          href="#"
          style={{ ...baseBtnStyle, backgroundColor: '#14b8a6', textDecoration: 'none' }} 
          onClick={(e) => addLog('F: aタグリンク', 'onClick', e)}
        >
          F: リンク (aタグ + onClick)
        </a>
      </div>

      <h2 style={{ fontSize: '18px', borderBottom: '2px solid #ccc', paddingBottom: '5px', marginBottom: '10px' }}>テストログ</h2>
      
      <div style={{ height: '200px', overflowY: 'auto', backgroundColor: '#f1f5f9', padding: '10px', borderRadius: '4px', marginBottom: '20px', fontSize: '12px', fontFamily: 'monospace' }}>
        {logs.length === 0 ? (
          <span style={{ color: '#94a3b8' }}>ここにログが表示されます...</span>
        ) : (
          logs.map((log) => (
            <div key={log.id} style={{ marginBottom: '4px', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px' }}>
              <span style={{ color: '#64748b', marginRight: '8px' }}>[{log.time}]</span>
              <strong>{log.pattern}</strong> 
              <span style={{ color: '#3b82f6', marginLeft: '8px' }}>({log.eventName})</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
