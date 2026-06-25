'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import styles from './menu.module.css';

// メニューのモックデータ
const MENU_ITEMS = [
  { menu_id: 'm1', name: '極み生ビール (中)', price: 580, category: 'drink', emoji: '🍺', desc: '氷点下で管理された、のどごし抜群のプレミアムモルツ。' },
  { menu_id: 'm2', name: '角ハイボール', price: 480, category: 'drink', emoji: '🥃', desc: '強炭酸で仕上げた爽快な一杯。レモン添え。' },
  { menu_id: 'm3', name: '秘伝の唐揚げ (4個)', price: 650, category: 'food', emoji: '🍗', desc: '秘伝のタレに丸一日漬け込んだジューシーな唐揚げ。' },
  { menu_id: 'm4', name: '炭火焼き鳥 5本盛り', price: 880, category: 'food', emoji: '🍢', desc: '一本ずつ丁寧に焼き上げた、タレと塩の盛り合わせ。' },
  { menu_id: 'm5', name: '濃厚醤油ラーメン', price: 920, category: 'food', emoji: '🍜', desc: 'じっくり煮込んだ特製醤油スープと自家製中細麺。' },
  { menu_id: 'm6', name: '彩り温野菜の温サラダ', price: 720, category: 'food', emoji: '🥗', desc: '季節の野菜を特製ごまドレッシングでさっぱりと。' },
  { menu_id: 'm7', name: '濃厚宇治抹茶アイス', price: 380, category: 'dessert', emoji: '🍨', desc: '京都宇治の厳選抹茶を使用した贅沢和風アイス。' },
];

interface CartItem {
  menu_id: string;
  name: string;
  price: number;
  quantity: number;
}

interface OrderHistoryItem {
  name: string;
  quantity: number;
  price: number;
}

interface Order {
  id: string;
  items: OrderHistoryItem[];
  status: 'pending' | 'served' | 'paid' | 'cancelled';
  created_at: string;
}

interface MenuContentProps {
  table_id: string;
  session_type: 'nfc' | 'qr';
}

export default function MenuContent({ table_id, session_type }: MenuContentProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isOrdering, setIsOrdering] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);

  // 1. 注文履歴のロードとリアルタイム購読
  useEffect(() => {
    if (!table_id) return;

    fetchOrderHistory();

    // 自分のテーブルの注文状況をリアルタイムで監視
    const channel = supabase
      .channel(`table-orders-${table_id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `table_id=eq.${table_id}` },
        (payload) => {
          console.log('Order update for this table:', payload);
          const updatedOrder = payload.new as Order;
          if (payload.eventType === 'INSERT') {
            setOrderHistory((prev) => [updatedOrder, ...prev]);
            showToast('新しい注文が受領されました。');
          } else if (payload.eventType === 'UPDATE') {
            setOrderHistory((prev) => {
              // 会計済み(paid)の注文は履歴から非表示にする
              if (updatedOrder.status === 'paid') {
                return prev.filter((o) => o.id !== updatedOrder.id);
              }
              return prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o));
            });
            if (updatedOrder.status === 'served') {
              showToast('お料理が提供されました！');
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table_id]);

  const fetchOrderHistory = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('table_id', table_id)
      .in('status', ['pending', 'served'])
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching history:', error);
    } else {
      setOrderHistory(data || []);
    }
  };

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage((prev) => (prev === message ? null : prev));
    }, 3000);
  };

  // カート操作
  const updateCartQty = (menuId: string, delta: number) => {
    const targetMenu = MENU_ITEMS.find((m) => m.menu_id === menuId);
    if (!targetMenu) return;

    setCart((prev) => {
      const existing = prev.find((item) => item.menu_id === menuId);
      if (existing) {
        const newQty = existing.quantity + delta;
        if (newQty <= 0) {
          return prev.filter((item) => item.menu_id !== menuId);
        }
        return prev.map((item) =>
          item.menu_id === menuId ? { ...item, quantity: newQty } : item
        );
      } else if (delta > 0) {
        return [...prev, { menu_id: menuId, name: targetMenu.name, price: targetMenu.price, quantity: 1 }];
      }
      return prev;
    });
  };

  const getCartQuantity = (menuId: string) => {
    return cart.find((item) => item.menu_id === menuId)?.quantity || 0;
  };

  const cartTotalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartTotalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  // 注文送信処理 (Cookie認証のため、トークンやパラメータは送信せず自動的にクッキーが使われる)
  const submitOrder = async () => {
    if (cart.length === 0) return;
    setIsOrdering(true);

    try {
      const orderPayload = {
        table_id,
        items: cart.map((item) => ({
          menu_id: item.menu_id,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
        }))
      };

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(`注文送信失敗: ${data.error || '不明なエラーが発生しました。'}`);
        if (res.status === 401 || res.status === 403) {
          window.location.href = '/checkout-complete';
        }
      } else {
        showToast('注文を確定しました！');
        setCart([]); // カートをクリア
        setShowConfirmModal(false);
        fetchOrderHistory(); // 履歴を更新
      }
    } catch (e) {
      console.error(e);
      alert('通信エラーにより注文が確定できませんでした。');
    } finally {
      setIsOrdering(false);
    }
  };

  return (
    <div className={styles.orderContainer}>
      {toastMessage && (
        <div className={`${styles.toast} glass-panel btn-primary`}>
          {toastMessage}
        </div>
      )}

      <header className={`${styles.header} glass-panel`}>
        <span className={styles.brand}>
          <span className="text-gradient-gold">Premium</span> Order
        </span>
        <span className={styles.tableBadge}>
          {table_id}番テーブル ({session_type.toUpperCase()})
        </span>
      </header>

      {/* メニューセクション */}
      <main className={styles.menuSection}>
        <h2 className={styles.sectionTitle}>お料理メニュー</h2>
        <div className={styles.menuGrid}>
          {MENU_ITEMS.map((item) => {
            const qty = getCartQuantity(item.menu_id);
            return (
              <div key={item.menu_id} className={`${styles.menuItemCard} glass-panel`}>
                <div className={styles.itemImage}>
                  {item.emoji}
                </div>
                
                <div className={styles.itemDetails}>
                  <div className={styles.itemName}>{item.name}</div>
                  <div className={styles.itemDescription}>{item.desc}</div>
                  <div className={styles.itemPrice}>¥{item.price.toLocaleString()}</div>
                </div>

                {qty > 0 ? (
                  <div className={styles.quantitySelector}>
                    <button className={styles.qtyBtn} onClick={() => updateCartQty(item.menu_id, -1)}>-</button>
                    <span className={styles.qtyValue}>{qty}</span>
                    <button className={styles.qtyBtn} onClick={() => updateCartQty(item.menu_id, 1)}>+</button>
                  </div>
                ) : (
                  <button className="btn btn-secondary addBtn" onClick={() => updateCartQty(item.menu_id, 1)}>
                    追加
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* 注文履歴セクション */}
      {orderHistory.length > 0 && (
        <section className={styles.historySection}>
          <div className={styles.historyTitleRow}>
            <h2 className={styles.sectionTitle}>ご注文履歴</h2>
            <div className={styles.historySummary}>
              <span className={styles.historySummaryLabel}>現在の注文合計:</span>
              <span className={styles.historySummaryValue}>
                ¥{orderHistory.reduce((sum, order) => {
                  return sum + order.items.reduce((itemSum, item) => itemSum + (item.price || 0) * item.quantity, 0);
                }, 0).toLocaleString()}
              </span>
            </div>
          </div>
          <div className={styles.historyList}>
            {orderHistory.map((order) => {
              const formattedTime = new Date(order.created_at).toLocaleTimeString('ja-JP', {
                hour: '2-digit',
                minute: '2-digit'
              });
              
              const orderTotal = order.items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0);
              
              return (
                <div key={order.id} className={`${styles.historyCard} glass-panel`}>
                  <div className={styles.historyHeader}>
                    <span className={styles.historyTime}>注文時刻: {formattedTime}</span>
                    <span className={order.status === 'served' ? 'badge badge-available' : 'badge badge-occupied'}>
                      {order.status === 'served' ? '提供済み' : '調理中'}
                    </span>
                  </div>
                  <div className={styles.historyItemsContainer}>
                    {order.items.map((item, idx) => (
                      <div key={idx} className={styles.historyItem}>
                        <div className={styles.historyItemMain}>
                          <span className={styles.historyItemName}>{item.name}</span>
                          <span className={styles.historyItemQty}>x {item.quantity}</span>
                        </div>
                        {item.price && (
                          <span className={styles.historyItemPrice}>¥{(item.price * item.quantity).toLocaleString()}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className={styles.historyCardFooter}>
                    <span>小計</span>
                    <span className={styles.historyCardTotal}>¥{orderTotal.toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 下部固定カートトレイ */}
      {cartTotalItems > 0 && (
        <div className={`${styles.cartTray} glass-panel`}>
          <div className={styles.cartInfo}>
            <span className={styles.cartCount}>{cartTotalItems}点の商品を選択中</span>
            <span className={styles.cartTotal}>¥{cartTotalAmount.toLocaleString()}</span>
          </div>
          <button className="btn btn-primary" onClick={() => setShowConfirmModal(true)}>
            注文を確認する
          </button>
        </div>
      )}

      {/* 注文確認モーダル */}
      {showConfirmModal && (
        <div className={styles.modalOverlay}>
          <div className={`${styles.modalContent} glass-panel`}>
            <h3 className={styles.modalTitle}>ご注文内容の確認</h3>
            
            <div className={styles.cartList}>
              {cart.map((item) => (
                <div key={item.menu_id} className={styles.cartListItem}>
                  <span>{item.name} x {item.quantity}</span>
                  <span>¥{(item.price * item.quantity).toLocaleString()}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <span>合計金額:</span>
              <span className={styles.cartTotal} style={{ fontSize: '1.25rem' }}>
                ¥{cartTotalAmount.toLocaleString()}
              </span>
            </div>

            <div className={styles.modalActions}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowConfirmModal(false)}
                disabled={isOrdering}
              >
                戻る
              </button>
              <button
                className="btn btn-primary"
                onClick={submitOrder}
                disabled={isOrdering}
              >
                {isOrdering ? '注文を送信中...' : 'この内容で注文する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
