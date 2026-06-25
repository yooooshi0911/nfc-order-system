-- NTAG 424 DNA 連携オーダーシステム データベーススキーマ

-- タイムゾーンの確認
SET timezone = 'Asia/Tokyo';

-- 既存テーブルのクリーンアップ
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS tables;

-- 1. tables テーブル (テーブル状態帳)
CREATE TABLE tables (
    table_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'available' CONSTRAINT tables_status_check CHECK (status IN ('available', 'occupied')),
    qr_token TEXT, -- フォールバックQR用のワンタイム・トークン
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. tags テーブル (タグ登録帳)
CREATE TABLE tags (
    uid TEXT PRIMARY KEY, -- NTAG 424 DNAの14文字の16進数UID
    serial_number TEXT NOT NULL, -- 通し番号 (例: "#0001")
    table_id TEXT REFERENCES tables(table_id) ON DELETE SET NULL, -- 紐付いているテーブル
    invalidated_ctr INTEGER NOT NULL DEFAULT 0, -- 退店時に更新されるカウンターしきい値
    current_max_ctr INTEGER NOT NULL DEFAULT 0, -- 現在のセッションの最大カウンター
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. orders テーブル (注文データ)
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id TEXT NOT NULL REFERENCES tables(table_id) ON DELETE CASCADE,
    items JSONB NOT NULL, -- 注文されたメニューアイテムと数量 (例: [{"menu_id": "m1", "name": "ビール", "quantity": 2, "price": 500}])
    status TEXT NOT NULL DEFAULT 'pending' CONSTRAINT orders_status_check CHECK (status IN ('pending', 'served', 'paid', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- updated_at を自動更新するトリガー関数の作成
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- tables テーブルにトリガーを適用
CREATE TRIGGER update_tables_modtime
    BEFORE UPDATE ON tables
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- 初期モックデータの挿入 (1番から8番テーブルまで作成)
INSERT INTO tables (table_id, status) VALUES
('01', 'available'),
('02', 'available'),
('03', 'available'),
('04', 'available'),
('05', 'available'),
('06', 'available'),
('07', 'available'),
('08', 'available');

-- デモ用の初期タグ登録 (テーブル01〜03に事前紐付け)
-- 実際の暗号検証を確認するため、仮のUIDをセット
INSERT INTO tags (uid, serial_number, table_id, invalidated_ctr, current_max_ctr) VALUES
('049F50824F1390', '#0001', '01', 0, 0),
('049F50824F1391', '#0002', '02', 0, 0),
('049F50824F1392', '#0003', '03', 0, 0);

-- Supabase Realtime の設定 (管理画面でのリアルタイム監視用)
-- tables と orders の更新をリアルタイム購読可能にする
BEGIN;
  -- publication が既に存在するか確認して作成
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
      CREATE PUBLICATION supabase_realtime;
    END IF;
  END
  $$;
  
  -- テーブルを publication に追加
  ALTER PUBLICATION supabase_realtime ADD TABLE tables;
  ALTER PUBLICATION supabase_realtime ADD TABLE orders;
COMMIT;

-- 4. テーブル会計処理用のアトミックトランザクション関数 (RPC)
CREATE OR REPLACE FUNCTION checkout_table(p_table_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_max_ctr INTEGER;
BEGIN
  -- 1. 紐付いているタグの現在の最大カウンターを取得
  SELECT COALESCE(current_max_ctr, 0) INTO v_max_ctr
  FROM tags
  WHERE table_id = p_table_id
  LIMIT 1;

  -- 2. タグの無効化カウンターを現在の最大値で上書き (過去URLの無効化)
  IF v_max_ctr IS NOT NULL THEN
    UPDATE tags
    SET invalidated_ctr = v_max_ctr
    WHERE table_id = p_table_id;
  END IF;

  -- 3. テーブルのステータスを空席(available)にし、QRトークンを無効化
  UPDATE tables
  SET status = 'available',
      qr_token = NULL
  WHERE table_id = p_table_id;

  -- 4. 該当テーブルの未会計の注文をすべて会計済み(paid)にする
  UPDATE orders
  SET status = 'paid'
  WHERE table_id = p_table_id AND status IN ('pending', 'served');
END;
$$ LANGUAGE plpgsql;

