'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import styles from './menu.module.css';

// メニューのモックデータ（和風居酒屋メニュー）
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

type TabType = 'menu' | 'history';

export default function MenuContent({ table_id, session_type }: MenuContentProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isOrdering, setIsOrdering] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('menu');

  // 1. 注文履歴のロードとリアルタイム購読
  useEffect(() => {
    if (!table_id) return;

    fetchOrderHistory();

    const channel = supabase
      .channel(`table-orders-${table_id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `table_id=eq.${table_id}` },
        (payload) => {
          const updatedOrder = payload.new as Order;
          if (payload.eventType === 'INSERT') {
            setOrderHistory((prev) => [updatedOrder, ...prev]);
            showToast('新しい注文が受領されました。');
          } else if (payload.eventType === 'UPDATE') {
            setOrderHistory((prev) => {
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
    try {
      const res = await fetch(`/api/orders?table_id=${table_id}`);
      if (!res.ok) throw new Error('Failed to fetch order history');
      const data = await res.json();
      
      const orders = data.orders || [];
      const filtered = orders.filter((o: Order) => 
        o.status === 'pending' || o.status === 'served'
      );
      setOrderHistory(filtered);
    } catch (error) {
      console.error('Error fetching history:', error);
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

  const historyTotalAmount = orderHistory.reduce((sum, order) => {
    return sum + order.items.reduce((itemSum, item) => itemSum + (item.price || 0) * item.quantity, 0);
  }, 0);

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
        setCart([]);
        setShowConfirmModal(false);
        setActiveTab('history'); // 注文完了後は履歴タブへ移動
        fetchOrderHistory();
      }
    } catch (e) {
      console.error(e);
      alert('通信エラーにより注文が確定できませんでした。');
    } finally {
      setIsOrdering(false);
    }
  };

  return (
    <div className={styles.appContainer}>
      {/* Toast */}
      {toastMessage && (
        <div className={styles.toast}>
          {toastMessage}
        </div>
      )}

      {/* ヘッダー */}
      <header className={styles.appHeader}>
        <div className={styles.brand}>
          <span className="text-gradient-gold">雅</span> - Miyabi -
        </div>
        <div className={styles.tableBadge}>
          {table_id}番席
        </div>
      </header>

      {/* メインコンテンツ領域（スクロール可能） */}
      <div className={styles.contentArea}>
        {activeTab === 'menu' && (
          <div className={`${styles.tabContent} animate-fade-in`}>
            <h2 className={styles.pageTitle}>お品書き</h2>
            <div className={styles.menuList}>
              {MENU_ITEMS.map((item) => {
                const qty = getCartQuantity(item.menu_id);
                return (
                  <div key={item.menu_id} className={styles.menuCard}>
                    <div className={styles.menuCardMain}>
                      <div className={styles.menuIcon}>{item.emoji}</div>
                      <div className={styles.menuInfo}>
                        <div className={styles.menuName}>{item.name}</div>
                        <div className={styles.menuDesc}>{item.desc}</div>
                        <div className={styles.menuPrice}>¥{item.price.toLocaleString()}</div>
                      </div>
                    </div>
                    <div className={styles.menuCardAction}>
                      {qty > 0 ? (
                        <div className={styles.qtyControl}>
                          <div 
                            className={styles.qtyBtnMobile} 
                            onClick={() => updateCartQty(item.menu_id, -1)}
                            role="button"
                          >-</div>
                          <span className={styles.qtyLabel}>{qty}</span>
                          <div 
                            className={styles.qtyBtnMobile} 
                            onClick={() => updateCartQty(item.menu_id, 1)}
                            role="button"
                          >+</div>
                        </div>
                      ) : (
                        <div 
                          className={styles.addBtnMobile} 
                          onClick={() => updateCartQty(item.menu_id, 1)}
                          role="button"
                        >
                          追加
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className={`${styles.tabContent} animate-fade-in`}>
            <h2 className={styles.pageTitle}>ご注文履歴</h2>
            
            <div className={styles.historyTotalCard}>
              <span className={styles.historyTotalLabel}>これまでの合計</span>
              <span className={styles.historyTotalValue}>¥{historyTotalAmount.toLocaleString()}</span>
            </div>

            {orderHistory.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>📝</div>
                <p>まだご注文はありません。</p>
              </div>
            ) : (
              <div className={styles.historyList}>
                {orderHistory.map((order) => {
                  const formattedTime = new Date(order.created_at).toLocaleTimeString('ja-JP', {
                    hour: '2-digit', minute: '2-digit'
                  });
                  const orderTotal = order.items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0);
                  
                  return (
                    <div key={order.id} className={styles.historyCard}>
                      <div className={styles.historyCardHeader}>
                        <span className={styles.historyTime}>{formattedTime}</span>
                        <span className={order.status === 'served' ? styles.statusServed : styles.statusPending}>
                          {order.status === 'served' ? '提供済み' : '調理中'}
                        </span>
                      </div>
                      <div className={styles.historyCardBody}>
                        {order.items.map((item, idx) => (
                          <div key={idx} className={styles.historyItemRow}>
                            <div className={styles.historyItemNameQty}>
                              <span className={styles.historyItemName}>{item.name}</span>
                              <span className={styles.historyItemQty}>x{item.quantity}</span>
                            </div>
                            <span className={styles.historyItemPrice}>
                              ¥{((item.price || 0) * item.quantity).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className={styles.historyCardFooter}>
                        <span>小計</span>
                        <span className={styles.historySubtotal}>¥{orderTotal.toLocaleString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ボトムナビゲーション */}
      <nav className={styles.bottomNav}>
        <div 
          className={`${styles.navItem} ${activeTab === 'menu' ? styles.navItemActive : ''}`}
          onClick={() => setActiveTab('menu')}
          role="button"
        >
          <span className={styles.navIcon}>📖</span>
          <span className={styles.navLabel}>お品書き</span>
        </div>
        
        <div 
          className={styles.navCartWrapper}
          onClick={() => { if (cartTotalItems > 0) setShowConfirmModal(true); }}
          role="button"
        >
          <div className={`${styles.navCartInner} ${cartTotalItems > 0 ? styles.navCartActive : ''}`}>
            <span className={styles.navCartIcon}>🛒</span>
            {cartTotalItems > 0 && (
              <span className={styles.cartBadge}>{cartTotalItems}</span>
            )}
          </div>
        </div>

        <div 
          className={`${styles.navItem} ${activeTab === 'history' ? styles.navItemActive : ''}`}
          onClick={() => setActiveTab('history')}
          role="button"
        >
          <span className={styles.navIcon}>🧾</span>
          <span className={styles.navLabel}>注文履歴</span>
        </div>
      </nav>

      {/* 全画面カートモーダル */}
      {showConfirmModal && (
        <div className={styles.fullModalOverlay}>
          <div className={styles.fullModalSheet}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>カートの内容</h3>
              <div 
                className={styles.closeBtn} 
                onClick={() => setShowConfirmModal(false)}
                role="button"
              >✕</div>
            </div>
            
            <div className={styles.modalBody}>
              {cart.map((item) => (
                <div key={item.menu_id} className={styles.cartRow}>
                  <div className={styles.cartRowInfo}>
                    <div className={styles.cartRowName}>{item.name}</div>
                    <div className={styles.cartRowPrice}>¥{item.price.toLocaleString()}</div>
                  </div>
                  <div className={styles.cartRowAction}>
                    <div className={styles.qtyControl}>
                      <div className={styles.qtyBtnMobile} onClick={() => updateCartQty(item.menu_id, -1)} role="button">-</div>
                      <span className={styles.qtyLabel}>{item.quantity}</span>
                      <div className={styles.qtyBtnMobile} onClick={() => updateCartQty(item.menu_id, 1)} role="button">+</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.modalFooter}>
              <div className={styles.modalTotalRow}>
                <span className={styles.modalTotalLabel}>合計</span>
                <span className={styles.modalTotalAmount}>¥{cartTotalAmount.toLocaleString()}</span>
              </div>
              <div 
                className={`${styles.submitBtn} ${isOrdering ? styles.submitting : ''}`}
                onClick={submitOrder}
                role="button"
              >
                {isOrdering ? '送信中...' : '注文を確定する'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
