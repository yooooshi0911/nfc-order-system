'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import styles from './menu.module.css';

export type LayoutSize = 'large' | 'medium' | 'small';

export interface MenuItemData {
  menu_id: string;
  name: string;
  price: number;
  category: string;
  emoji?: string;
  desc?: string;
  image?: string;
  badge?: string;
  soldOut?: boolean;
  layoutSize?: LayoutSize;
}

// 新デザインに合わせたモックデータ
const MENU_ITEMS: MenuItemData[] = [
  // 定食 (中サイズグリッド)
  { menu_id: 'm1', name: '一日定食', price: 1300, category: 'teishoku', image: '/images/teishoku.png', layoutSize: 'medium' },
  { menu_id: 'm2', name: '元気定食', price: 1300, category: 'teishoku', image: '/images/teishoku.png', badge: '当店1番人気!', layoutSize: 'medium' },
  { menu_id: 'm3', name: '回復定食', price: 1350, category: 'teishoku', image: '/images/teishoku.png', layoutSize: 'medium' },
  { menu_id: 'm4', name: '満点定食', price: 1350, category: 'teishoku', image: '/images/teishoku.png', layoutSize: 'medium' },
  { menu_id: 'm5', name: 'ヴィーガン定食', price: 1400, category: 'teishoku', image: '/images/teishoku.png', soldOut: true, layoutSize: 'medium' },
  // おすすめ・ディナー (大サイズ)
  { menu_id: 'm6', name: '薬膳おでん 盛り合わせ', price: 1200, category: 'recommend', image: '/images/oden.png', layoutSize: 'large' },
  { menu_id: 'm7', name: 'とろあじ定食', price: 1980, category: 'dinner', image: '/images/teishoku.png', badge: '夜限定!!', layoutSize: 'large' },
  // 逸品 (中〜小サイズ)
  { menu_id: 'm8', name: '炭火焼き鳥 5本盛り', price: 880, category: 'ippin', image: '/images/yakitori.png', layoutSize: 'medium' },
  // 追加メニュー (小サイズ)
  { menu_id: 'a1', name: '西たまご', price: 200, category: 'side', image: '/images/oden.png', layoutSize: 'small' },
  { menu_id: 'a2', name: 'とろろ', price: 200, category: 'side', image: '/images/oden.png', layoutSize: 'small' },
  { menu_id: 'a3', name: '納豆', price: 200, category: 'side', image: '/images/oden.png', layoutSize: 'small' },
];

export const CATEGORIES = [
  { id: 'teishoku', label: '定食' },
  { id: 'side', label: '追加メニュー' },
  { id: 'recommend', label: 'おすすめ' },
  { id: 'dinner', label: '夜限定' },
  { id: 'ippin', label: '一品' },
];

interface CartItem {
  cart_id: string;
  menu_id: string;
  name: string;
  price: number;
  quantity: number;
  options?: string[];
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

  // カスタマイズモーダル用ステート
  const [selectedItemForCustomization, setSelectedItemForCustomization] = useState<MenuItemData | null>(null);
  const [ricePortion, setRicePortion] = useState<'small' | 'regular' | 'large'>('regular');
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);

  const RICE_OPTIONS = {
    small: { label: '小盛', price: -50 },
    regular: { label: '普通', price: 0 },
    large: { label: '大盛', price: 100 },
  };

  const ADDON_OPTIONS = [
    { id: 'raw_egg', label: '生卵', price: 100 },
    { id: 'natto', label: '納豆', price: 150 },
  ];


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
  const updateCartQty = (cart_id: string, delta: number, menuIdForNewItem?: string) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.cart_id === cart_id);
      if (existing) {
        const newQty = existing.quantity + delta;
        if (newQty <= 0) {
          return prev.filter((item) => item.cart_id !== cart_id);
        }
        return prev.map((item) =>
          item.cart_id === cart_id ? { ...item, quantity: newQty } : item
        );
      } else if (delta > 0 && menuIdForNewItem) {
        const targetMenu = MENU_ITEMS.find((m) => m.menu_id === menuIdForNewItem);
        if (targetMenu) {
          return [...prev, { cart_id, menu_id: targetMenu.menu_id, name: targetMenu.name, price: targetMenu.price, quantity: 1 }];
        }
      }
      return prev;
    });
  };

  const getCartQuantityForMenuId = (menuId: string) => {
    return cart.filter((item) => item.menu_id === menuId).reduce((sum, item) => sum + item.quantity, 0);
  };

  const handleMenuAddClick = (item: MenuItemData) => {
    if (item.category === 'teishoku' || item.category === 'dinner') {
      setSelectedItemForCustomization(item);
      setRicePortion('regular');
      setSelectedAddons([]);
    } else {
      updateCartQty(item.menu_id, 1, item.menu_id);
    }
  };

  const handleAddCustomizedItem = () => {
    if (!selectedItemForCustomization) return;
    
    const optionsTextList: string[] = [];
    if (ricePortion !== 'regular') optionsTextList.push(`ご飯${RICE_OPTIONS[ricePortion].label}`);
    
    const sortedAddons = [...selectedAddons].sort();
    sortedAddons.forEach(addonId => {
      const addon = ADDON_OPTIONS.find(a => a.id === addonId);
      if (addon) optionsTextList.push(addon.label);
    });

    const cart_id = `${selectedItemForCustomization.menu_id}-${ricePortion}-${sortedAddons.join('-')}`;
    
    const basePrice = selectedItemForCustomization.price;
    const customizedPrice = basePrice + RICE_OPTIONS[ricePortion].price + selectedAddons.reduce((sum, addonId) => {
      const addon = ADDON_OPTIONS.find(a => a.id === addonId);
      return sum + (addon ? addon.price : 0);
    }, 0);

    setCart((prev) => {
      const existing = prev.find((item) => item.cart_id === cart_id);
      if (existing) {
        return prev.map((item) =>
          item.cart_id === cart_id ? { ...item, quantity: item.quantity + 1 } : item
        );
      } else {
        return [...prev, { 
          cart_id, 
          menu_id: selectedItemForCustomization.menu_id, 
          name: selectedItemForCustomization.name, 
          price: customizedPrice, 
          quantity: 1, 
          options: optionsTextList 
        }];
      }
    });

    setSelectedItemForCustomization(null);
    showToast('カートに追加しました');
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
        items: cart.map((item) => {
          const optionsText = item.options && item.options.length > 0 ? ` (${item.options.join(', ')})` : '';
          return {
            menu_id: item.menu_id,
            name: `${item.name}${optionsText}`,
            quantity: item.quantity,
            price: item.price,
          };
        })
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
          <div className={`${styles.menuLayout} animate-fade-in`}>
            {/* 左サイドバー */}
            <aside className={styles.sidebar}>
              <ul className={styles.sidebarList}>
                {CATEGORIES.map((c) => (
                  <li key={c.id} className={styles.sidebarItem}>
                    <a href={`#cat-${c.id}`}>{c.label}</a>
                  </li>
                ))}
              </ul>
            </aside>
            
            {/* メイン商品一覧 */}
            <div className={styles.mainContent}>
              <h2 className={styles.pageTitle}>お品書き</h2>
              {CATEGORIES.map((category) => {
                const items = MENU_ITEMS.filter((item) => item.category === category.id);
                if (items.length === 0) return null;
                
                return (
                  <section key={category.id} id={`cat-${category.id}`} className={styles.categorySection}>
                    <h3 className={styles.categoryTitle}>{category.label}</h3>
                    <div className={styles.gridContainer}>
                      {items.map((item) => {
                        const isCustomizable = item.category === 'teishoku' || item.category === 'dinner';
                        const qty = isCustomizable ? 0 : getCartQuantityForMenuId(item.menu_id);
                        const cardClass = 
                          item.layoutSize === 'large' ? styles.cardLarge :
                          item.layoutSize === 'medium' ? styles.cardMedium :
                          styles.cardSmall;

                        return (
                          <div key={item.menu_id} className={`${styles.menuCard} ${cardClass}`}>
                            {item.badge && <div className={styles.badgeRed}>{item.badge}</div>}
                            
                            {item.image ? (
                              <div className={styles.imageContainer}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={item.image} alt={item.name} className={styles.menuImage} />
                                {item.soldOut && <div className={styles.soldOutOverlay}>SOLD OUT</div>}
                              </div>
                            ) : (
                              <div className={styles.imageContainer}>
                                <div className={styles.menuIcon}>{item.emoji}</div>
                                {item.soldOut && <div className={styles.soldOutOverlay}>SOLD OUT</div>}
                              </div>
                            )}
                            
                            <div className={styles.menuInfo}>
                              <div className={styles.menuName}>{item.name}</div>
                              {item.desc && <div className={styles.menuDesc}>{item.desc}</div>}
                              <div className={styles.menuPrice}>¥{item.price.toLocaleString()}</div>
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
                                    onClick={() => updateCartQty(item.menu_id, 1, item.menu_id)}
                                    role="button"
                                  >+</div>
                                </div>
                              ) : (
                                <button 
                                  className={`${styles.addBtnMobile} ${item.soldOut ? styles.soldOutBtn : ''}`}
                                  onClick={() => !item.soldOut && handleMenuAddClick(item)}
                                  disabled={item.soldOut}
                                >
                                  {item.soldOut ? '売切' : '追加'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
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
                <div key={item.cart_id} className={styles.cartRow}>
                  <div className={styles.cartRowInfo}>
                    <div className={styles.cartRowName}>{item.name}</div>
                    {item.options && item.options.length > 0 && (
                      <div className={styles.cartRowOptions}>{item.options.join(', ')}</div>
                    )}
                    <div className={styles.cartRowPrice}>¥{item.price.toLocaleString()}</div>
                  </div>
                  <div className={styles.cartRowAction}>
                    <div className={styles.qtyControl}>
                      <div className={styles.qtyBtnMobile} onClick={() => updateCartQty(item.cart_id, -1)} role="button">-</div>
                      <span className={styles.qtyLabel}>{item.quantity}</span>
                      <div className={styles.qtyBtnMobile} onClick={() => updateCartQty(item.cart_id, 1)} role="button">+</div>
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

      {/* カスタマイズモーダル */}
      {selectedItemForCustomization && (
        <div className={styles.customizeModalOverlay}>
          <div className={styles.customizeModalSheet}>
            {selectedItemForCustomization.image && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img 
                src={selectedItemForCustomization.image} 
                alt={selectedItemForCustomization.name} 
                className={styles.customizeImage} 
              />
            )}
            <div className={styles.customizeHeaderInfo}>
              <div className={styles.customizeName}>{selectedItemForCustomization.name}</div>
              {selectedItemForCustomization.desc && (
                <div className={styles.customizeDesc}>{selectedItemForCustomization.desc}</div>
              )}
              <div className={styles.customizeBasePrice}>¥{selectedItemForCustomization.price.toLocaleString()}〜</div>
            </div>

            <div className={styles.customizeOptions}>
              {/* ご飯の量 */}
              <div className={styles.optionSection}>
                <div className={styles.optionTitle}>ご飯の量</div>
                <div className={styles.optionList}>
                  {(['small', 'regular', 'large'] as const).map(optionKey => (
                    <label key={optionKey} className={styles.optionLabel}>
                      <div className={styles.optionLabelLeft}>
                        <input 
                          type="radio" 
                          name="rice_portion" 
                          value={optionKey} 
                          checked={ricePortion === optionKey}
                          onChange={() => setRicePortion(optionKey)}
                          className={styles.radioInput}
                        />
                        <span className={styles.optionLabelText}>{RICE_OPTIONS[optionKey].label}</span>
                      </div>
                      <span className={styles.optionPrice}>
                        {RICE_OPTIONS[optionKey].price > 0 ? `+¥${RICE_OPTIONS[optionKey].price}` : RICE_OPTIONS[optionKey].price < 0 ? `-¥${Math.abs(RICE_OPTIONS[optionKey].price)}` : '±¥0'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 追加メニュー */}
              <div className={styles.optionSection}>
                <div className={styles.optionTitle}>おすすめ追加メニュー</div>
                <div className={styles.optionList}>
                  {ADDON_OPTIONS.map(addon => (
                    <label key={addon.id} className={styles.optionLabel}>
                      <div className={styles.optionLabelLeft}>
                        <input 
                          type="checkbox" 
                          checked={selectedAddons.includes(addon.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAddons(prev => [...prev, addon.id]);
                            } else {
                              setSelectedAddons(prev => prev.filter(id => id !== addon.id));
                            }
                          }}
                          className={styles.checkboxInput}
                        />
                        <span className={styles.optionLabelText}>{addon.label}</span>
                      </div>
                      <span className={styles.optionPrice}>+¥{addon.price}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <div className={styles.modalTotalRow}>
                <span className={styles.modalTotalLabel}>追加金額</span>
                <span className={styles.modalTotalAmount}>
                  ¥{(
                    selectedItemForCustomization.price +
                    RICE_OPTIONS[ricePortion].price +
                    selectedAddons.reduce((sum, id) => sum + (ADDON_OPTIONS.find(a => a.id === id)?.price || 0), 0)
                  ).toLocaleString()}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div 
                  className={styles.submitBtn} 
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', flex: 1 }}
                  onClick={() => setSelectedItemForCustomization(null)}
                  role="button"
                >
                  キャンセル
                </div>
                <div 
                  className={styles.submitBtn} 
                  style={{ flex: 2 }}
                  onClick={handleAddCustomizedItem}
                  role="button"
                >
                  カートに追加
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
