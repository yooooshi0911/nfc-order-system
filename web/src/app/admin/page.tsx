'use client';

import { useEffect, useState } from 'react';
import styles from './admin.module.css';
import QRCode from 'qrcode';

interface Table {
  table_id: string;
  status: 'available' | 'occupied';
  qr_token: string | null;
  updated_at: string;
}

interface Tag {
  uid: string;
  serial_number: string;
  table_id: string | null;
  invalidated_ctr: number;
  current_max_ctr: number;
}

interface OrderItem {
  menu_id: string;
  name: string;
  quantity: number;
  price: number;
}

interface Order {
  id: string;
  table_id: string;
  items: OrderItem[];
  status: 'pending' | 'served' | 'paid' | 'cancelled';
  created_at: string;
}

export default function AdminPage() {
  const [tables, setTables] = useState<Table[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [qrModalData, setQrModalData] = useState<{ tableId: string; qrUrl: string; qrCodeDataUrl: string } | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  // 画面のメイン表示切り替え用 ('tables' = 席状況, 'orders' = 注文フィード, 'settings' = テーブル & タグ設定)
  const [activeMenu, setActiveMenu] = useState<'tables' | 'orders' | 'settings'>('tables');

  // マスターデータ設定用サブタブ ('tables' | 'tags')
  const [activeTab, setActiveTab] = useState<'tables' | 'tags'>('tables');
  const [newTableId, setNewTableId] = useState('');
  const [newTagUid, setNewTagUid] = useState('');
  const [newTagSerial, setNewTagSerial] = useState('');
  const [newTagTableId, setNewTagTableId] = useState('');

  // 1. 初回ロード & 定期ポーリング設定
  useEffect(() => {
    fetchInitialData();

    // 3秒おきの定期ポーリング (API経由で最新データを取得)
    const pollInterval = setInterval(() => {
      fetchInitialData();
    }, 3000);

    return () => clearInterval(pollInterval);
  }, []);

  const fetchInitialData = async () => {
    try {
      const res = await fetch('/api/admin/dashboard');
      if (!res.ok) throw new Error('Failed to fetch dashboard data');
      const data = await res.json();
      
      if (data.success) {
        setTables(data.tables || []);
        setTags(data.tags || []);
        setOrders(data.orders || []);
        setIsOnline(true);
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setIsOnline(false);
    }
  };

  // 3. 利用開始 (Check-in)
  const handleCheckin = async (tableId: string) => {
    setLoadingAction(`checkin-${tableId}`);
    try {
      const res = await fetch('/api/tables/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_id: tableId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`利用開始エラー: ${data.error}`);
      } else {
        console.log(`Table ${tableId} is now occupied. QR Token: ${data.qr_token}`);
        setTables((prev) =>
          prev.map((t) =>
            t.table_id === tableId ? { ...t, status: 'occupied', qr_token: data.qr_token } : t
          )
        );
      }
    } catch (e) {
      console.error(e);
      alert('通信エラーが発生しました。');
    } finally {
      setLoadingAction(null);
    }
  };

  // 4. 会計完了 (Check-out)
  const handleCheckout = async (tableId: string) => {
    if (!confirm(`${tableId}番テーブルの会計を完了し、空席に戻しますか？\n（過去のセッションURLはすべて無効化されます）`)) {
      return;
    }
    setLoadingAction(`checkout-${tableId}`);
    try {
      const res = await fetch('/api/tables/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_id: tableId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`会計エラー: ${data.error}`);
      } else {
        console.log(`Table ${tableId} is now available.`);
        setTables((prev) =>
          prev.map((t) =>
            t.table_id === tableId ? { ...t, status: 'available', qr_token: null } : t
          )
        );
        fetchInitialData(); // カウンターしきい値(invalidated_ctr)反映のため再フェッチ
      }
    } catch (e) {
      console.error(e);
      alert('通信エラーが発生しました。');
    } finally {
      setLoadingAction(null);
    }
  };

  // 5. 注文ステータスの更新
  const updateOrderStatus = async (orderId: string, newStatus: 'served' | 'cancelled') => {
    try {
      const res = await fetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update order status');

      // UIを即時更新
      setOrders((prev) => {
        if (newStatus === 'cancelled') {
          return prev.filter((o) => o.id !== orderId);
        }
        return prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o));
      });
    } catch (err) {
      console.error('Error updating order status:', err);
      alert('注文ステータスの更新に失敗しました。');
    }
  };

  // 6. フォールバック用 QRコードの発行
  const showFallbackQr = async (table: Table) => {
    if (!table.qr_token) {
      alert('テーブルが利用中ではないか、トークンが生成されていません。先に「案内開始」を行ってください。');
      return;
    }

    // PC(localhost)から開いた場合でもスマホからアクセスできるようにIPを強制する
    const currentOrigin = window.location.origin;
    const origin = currentOrigin.includes('localhost') 
      ? currentOrigin.replace('localhost', '192.168.0.194') 
      : currentOrigin;
      
    const qrUrl = `${origin}/auth?table_id=${table.table_id}&token=${table.qr_token}`;
    
    try {
      const qrDataUrl = await QRCode.toDataURL(qrUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#0a0c10',
          light: '#ffffff',
        },
      });
      
      setQrModalData({
        tableId: table.table_id,
        qrUrl: qrUrl,
        qrCodeDataUrl: qrDataUrl,
      });
    } catch (err) {
      console.error('QR Code generation error:', err);
      alert('QRコードの生成に失敗しました。');
    }
  };

  // --- API 経由での CRUD: テーブル管理アクション (RLS回避) ---
  const handleAddTable = async (e: React.FormEvent) => {
    e.preventDefault();
    const tid = newTableId.trim();
    if (!tid) return;

    if (tables.some(t => t.table_id === tid)) {
      alert('このテーブル番号はすでに登録されています。');
      return;
    }

    try {
      const res = await fetch('/api/admin/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_id: tid })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`テーブル追加に失敗しました: ${data.error}`);
      } else {
        setNewTableId('');
        fetchInitialData();
      }
    } catch (err) {
      console.error(err);
      alert('テーブル追加中に通信エラーが発生しました。');
    }
  };

  const handleDeleteTable = async (tableId: string) => {
    if (!confirm(`テーブル ${tableId} を削除しますか？\n（このテーブルに紐付いているタグの紐付けは解除されます）`)) return;

    try {
      const res = await fetch(`/api/admin/tables?table_id=${tableId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`テーブル削除に失敗しました: ${data.error}`);
      } else {
        fetchInitialData();
      }
    } catch (err) {
      console.error(err);
      alert('テーブル削除中に通信エラーが発生しました。');
    }
  };

  // --- API 経由での CRUD: タグ管理アクション (RLS回避) ---
  const handleRegisterTag = async (e: React.FormEvent) => {
    e.preventDefault();
    const uid = newTagUid.trim().toUpperCase();
    const serial = newTagSerial.trim();
    const tableId = newTagTableId === 'none' ? null : newTagTableId;

    if (!uid || uid.length !== 14) {
      alert('14文字の16進数UIDを入力してください。');
      return;
    }
    if (!serial) {
      alert('通し番号（例: #0004）を入力してください。');
      return;
    }

    if (tags.some(t => t.uid === uid)) {
      alert('このタグUIDはすでに登録されています。');
      return;
    }

    try {
      const res = await fetch('/api/admin/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, serial_number: serial, table_id: tableId })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`タグ登録に失敗しました: ${data.error}`);
      } else {
        setNewTagUid('');
        setNewTagSerial('');
        setNewTagTableId('');
        fetchInitialData();
      }
    } catch (err) {
      console.error(err);
      alert('タグ登録中に通信エラーが発生しました。');
    }
  };

  const handleUpdateTagTable = async (uid: string, tableId: string) => {
    try {
      const res = await fetch('/api/admin/tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, table_id: tableId })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`タグ紐付け更新に失敗しました: ${data.error}`);
      } else {
        fetchInitialData();
      }
    } catch (err) {
      console.error(err);
      alert('タグ更新中に通信エラーが発生しました。');
    }
  };

  const handleDeleteTag = async (uid: string) => {
    if (!confirm(`タグ ${uid} の登録を解除しますか？`)) return;

    try {
      const res = await fetch(`/api/admin/tags?uid=${uid}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`タグ削除に失敗しました: ${data.error}`);
      } else {
        fetchInitialData();
      }
    } catch (err) {
      console.error(err);
      alert('タグ削除中に通信エラーが発生しました。');
    }
  };

  return (
    <div className={styles.adminContainer}>
      <header className={styles.header}>
        <div className={styles.titleSection}>
          <h1 className="text-gradient-gold">帳場 - Management</h1>
          <p>NTAG 424 DNA 連携セキュア注文・稼働管理システム</p>
        </div>
        <div className={styles.dbIndicator}>
          <div className={`${styles.dbDot} ${isOnline ? '' : styles.offline}`} />
          <span>{isOnline ? 'DB同期中 (リアルタイム)' : 'ポーリング中'}</span>
        </div>
      </header>

      {/* 画面切り替えメインタブ (レスポンシブ考慮) */}
      <div className={styles.menuTabRow}>
        <button
          className={`${styles.tabBtn} ${activeMenu === 'tables' ? styles.active : ''}`}
          onClick={() => setActiveMenu('tables')}
        >
          <span>📊</span> 座席管理
        </button>
        <button
          className={`${styles.tabBtn} ${activeMenu === 'orders' ? styles.active : ''}`}
          onClick={() => setActiveMenu('orders')}
        >
          <span>🧾</span> 注文フィード
          {orders.length > 0 && (
            <span className={styles.badgeAlert} style={{ marginLeft: '8px', background: 'var(--accent-rose)', color: 'white', padding: '2px 6px', borderRadius: '10px', fontSize: '0.75rem' }}>{orders.length}</span>
          )}
        </button>
        <button
          className={`${styles.tabBtn} ${activeMenu === 'settings' ? styles.active : ''}`}
          onClick={() => setActiveMenu('settings')}
        >
          <span>⚙️</span> マスタ設定
        </button>
      </div>

      {activeMenu === 'tables' && (
        <section className={`${styles.tablesSection} animate-fade-in`}>
            <h2 style={{ marginBottom: '20px', fontSize: '1.25rem', borderLeft: '3px solid var(--accent-gold)', paddingLeft: '10px' }}>
              座席稼働状況
            </h2>
            <div className={styles.tablesGrid}>
              {tables.map((table) => {
                const tableTag = tags.find((t) => t.table_id === table.table_id);
                const isOccupied = table.status === 'occupied';
                const isLoading = loadingAction === `checkin-${table.table_id}` || loadingAction === `checkout-${table.table_id}`;

                return (
                  <div
                    key={table.table_id}
                    className={`${styles.tableCard} glass-panel ${isOccupied ? styles.occupied : styles.available}`}
                  >
                    <div className={styles.cardHeader}>
                      <div className={styles.tableName}>{table.table_id}番席</div>
                      <span className={`badge ${isOccupied ? 'badge-occupied' : 'badge-available'}`}>
                        {isOccupied ? '利用中' : '空席'}
                      </span>
                    </div>
                    
                    <div className={styles.cardBody}>
                      {isOccupied ? (
                        <div>
                          <p style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>お食事中</p>
                          {tableTag && (
                            <div className={styles.counterInfo}>
                              NFC カウンター: {tableTag.current_max_ctr}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p style={{ color: 'var(--text-muted)' }}>ご案内可能</p>
                      )}
                    </div>

                    <div className={styles.cardActions}>
                      {isOccupied ? (
                        <>
                          <button
                            className="btn btn-rose"
                            onClick={() => handleCheckout(table.table_id)}
                            disabled={isLoading}
                          >
                            {isLoading ? '処理中...' : '会計完了'}
                          </button>
                          <button
                            className={styles.qrBtn}
                            onClick={() => showFallbackQr(table)}
                            title="QRコードを表示"
                            disabled={isLoading}
                          >
                            QR
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn-emerald"
                          onClick={() => handleCheckin(table.table_id)}
                          disabled={isLoading}
                        >
                          {isLoading ? '処理中...' : '利用開始 (案内)'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
      )}

      {activeMenu === 'orders' && (
        <section className={`${styles.ordersSection} animate-fade-in`}>
          <aside className={`${styles.orderFeed} glass-panel`}>
            <div className={styles.feedHeader}>
              <div className={styles.feedTitle}>注文フィード</div>
              <span className="badge badge-occupied">{orders.length} 件</span>
            </div>

            <div className={styles.orderList}>
              {orders.length === 0 ? (
                <div className={styles.emptyOrders}>
                  未提供の注文はありません
                </div>
              ) : (
                orders.map((order) => {
                  const formattedTime = new Date(order.created_at).toLocaleTimeString('ja-JP', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  });

                  return (
                    <div key={order.id} className={styles.orderCard}>
                      <div className={styles.orderCardHeader}>
                        <span className={styles.orderTableId}>{order.table_id}番席</span>
                        <span className={styles.orderTime}>{formattedTime}</span>
                      </div>

                      <ul className={styles.orderItems}>
                        {order.items.map((item, idx) => (
                          <li key={idx} className={styles.orderItem}>
                            <span className={styles.itemName}>{item.name}</span>
                            <span className={styles.itemQty}>x {item.quantity}</span>
                          </li>
                        ))}
                      </ul>

                      <div className={styles.orderCardActions}>
                        {order.status === 'pending' ? (
                          <>
                            <button
                              className="btn btn-secondary"
                              onClick={() => updateOrderStatus(order.id, 'cancelled')}
                              style={{ padding: '6px 12px', minHeight: '36px', minWidth: '50px' }}
                            >
                              取消
                            </button>
                            <button
                              className="btn btn-emerald"
                              onClick={() => updateOrderStatus(order.id, 'served')}
                              style={{ padding: '6px 12px', minHeight: '36px', minWidth: '70px' }}
                            >
                              提供済
                            </button>
                          </>
                        ) : (
                          <span className="badge badge-available" style={{ fontSize: '0.7rem' }}>
                            提供済み
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </section>
      )}

      {activeMenu === 'settings' && (
        /* 設定画面 (ダッシュボード非表示時はこちらを全幅表示) */
        <section className={`${styles.managementSection} animate-fade-in`}>
          <div className={styles.sectionHeader}>
            <h2 style={{ fontSize: '1.25rem', borderLeft: '3px solid var(--accent-gold)', paddingLeft: '10px' }}>店舗マスタ設定</h2>
            <div className={styles.tabs}>
              <button
                className={`${styles.tabBtn} ${activeTab === 'tables' ? styles.active : ''}`}
                onClick={() => setActiveTab('tables')}
              >
                テーブル設定
              </button>
              <button
                className={`${styles.tabBtn} ${activeTab === 'tags' ? styles.active : ''}`}
                onClick={() => setActiveTab('tags')}
              >
                NFCタグ設定
              </button>
            </div>
          </div>

          {activeTab === 'tables' ? (
            <div className={styles.managePanel}>
              {/* テーブル追加フォーム */}
              <form onSubmit={handleAddTable} className={styles.formGroup}>
                <div className={styles.inputField}>
                  <label htmlFor="new_table_id">新規座席番号</label>
                  <input
                    id="new_table_id"
                    type="text"
                    placeholder="例: 09"
                    value={newTableId}
                    onChange={(e) => setNewTableId(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-emerald" style={{ padding: '10px 24px', minHeight: '44px' }}>
                  座席追加
                </button>
              </form>

              {/* テーブル一覧と削除 */}
              <div className={styles.manageTableWrapper}>
                <table className={styles.manageTable}>
                  <thead>
                    <tr>
                      <th>座席番号</th>
                      <th>現在の状態</th>
                      <th>QRトークン</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.map(t => (
                      <tr key={t.table_id}>
                        <td style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>{t.table_id}番席</td>
                        <td>
                          <span className={`badge ${t.status === 'occupied' ? 'badge-occupied' : 'badge-available'}`}>
                            {t.status === 'occupied' ? '利用中' : '空席'}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'Consolas, monospace', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {t.qr_token || '-'}
                        </td>
                        <td>
                          <button
                            className="btn btn-rose"
                            style={{ padding: '6px 12px', fontSize: '0.8rem', minHeight: '32px' }}
                            onClick={() => handleDeleteTable(t.table_id)}
                            disabled={t.status === 'occupied'}
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className={styles.managePanel}>
              {/* タグ追加フォーム */}
              <form onSubmit={handleRegisterTag} className={styles.formGroup}>
                <div className={styles.inputField}>
                  <label htmlFor="tag_uid">タグ UID (14文字の16進数)</label>
                  <input
                    id="tag_uid"
                    type="text"
                    maxLength={14}
                    placeholder="例: 049F50824F1390"
                    value={newTagUid}
                    onChange={(e) => setNewTagUid(e.target.value)}
                  />
                </div>
                <div className={styles.inputField}>
                  <label htmlFor="tag_serial">通し番号 (シリアル)</label>
                  <input
                    id="tag_serial"
                    type="text"
                    placeholder="例: #0004"
                    value={newTagSerial}
                    onChange={(e) => setNewTagSerial(e.target.value)}
                  />
                </div>
                <div className={styles.inputField}>
                  <label htmlFor="tag_table">紐付け座席</label>
                  <select
                    id="tag_table"
                    value={newTagTableId}
                    onChange={(e) => setNewTagTableId(e.target.value)}
                    style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)' }}
                  >
                    <option value="none">紐付けなし</option>
                    {tables.map(t => (
                      <option key={t.table_id} value={t.table_id}>
                        {t.table_id}番席
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn btn-emerald" style={{ padding: '10px 24px', minHeight: '44px' }}>
                  新規タグ登録
                </button>
              </form>

              {/* タグ一覧・紐付け更新・削除 */}
              <div className={styles.manageTableWrapper}>
                <table className={styles.manageTable}>
                  <thead>
                    <tr>
                      <th>シリアル</th>
                      <th>タグ UID</th>
                      <th>紐付け座席</th>
                      <th>カウンター状況</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tags.map(tag => (
                      <tr key={tag.uid}>
                        <td style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>{tag.serial_number}</td>
                        <td style={{ fontFamily: 'Consolas, monospace', fontSize: '0.85rem', color: 'var(--text-primary)' }}>{tag.uid}</td>
                        <td>
                          <select
                            value={tag.table_id || 'none'}
                            onChange={(e) => handleUpdateTagTable(tag.uid, e.target.value)}
                            style={{
                              background: 'var(--bg-primary)',
                              border: '1px solid var(--glass-border)',
                              color: 'var(--text-primary)',
                              padding: '6px 12px',
                              borderRadius: 'var(--radius-sm)',
                              outline: 'none'
                            }}
                          >
                            <option value="none">紐付けなし</option>
                            {tables.map(t => (
                              <option key={t.table_id} value={t.table_id}>
                                {t.table_id}番席
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          最大: {tag.current_max_ctr} / 無効: {tag.invalidated_ctr}
                        </td>
                        <td>
                          <button
                            className="btn btn-rose"
                            style={{ padding: '6px 12px', fontSize: '0.8rem', minHeight: '32px' }}
                            onClick={() => handleDeleteTag(tag.uid)}
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* フォールバックQR表示モーダル */}
      {qrModalData && (
        <div className={styles.modalOverlay} onClick={() => setQrModalData(null)}>
          <div className={`${styles.modalContent} glass-panel`} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-gradient-gold" style={{ fontSize: '1.4rem' }}>
              {qrModalData.tableId}番席 QRコード
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              NFC非対応スマホの場合は、このQRコードを読み取って注文画面を開いてください。
            </p>
            
            <div className={styles.qrContainer}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrModalData.qrCodeDataUrl} alt={`Table ${qrModalData.tableId} QR Code`} />
            </div>

            <div className={styles.qrUrl}>{qrModalData.qrUrl}</div>

            <button className="btn btn-secondary closeBtn" onClick={() => setQrModalData(null)} style={{ width: '100%', minHeight: '44px', marginTop: '10px' }}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
