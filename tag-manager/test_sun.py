"""
NTAG 424 DNA SUN機能テストスクリプト (PC/SC版)
カードリーダー: ACS ACR1251 CL Reader

このスクリプトは以下をテストします:
1. PC/SC経由でACR1251に接続
2. NTAG 424 DNA タグの検知とUID取得
3. NDEF読み取りでSUN (uid + ctr + mac) パラメータを確認
4. 工場出荷時デフォルトキー (all 0x00) でMAC検証

【前提】
- パスワードなし、工場出荷時のまま
- MASTER_KEY はすべて 0x00 (NXPのデフォルト)

使い方: スクリプト起動後、タグをリーダーにかざす
"""

import sys
import time
import binascii

try:
    from smartcard.System import readers
    from smartcard.util import toHexString, toBytes
    from smartcard.CardConnection import CardConnection
    from smartcard.Exceptions import CardConnectionException, NoCardException
except ImportError:
    print("ERROR: pyscard がインストールされていません")
    sys.exit(1)

try:
    from Crypto.Hash import CMAC
    from Crypto.Cipher import AES
except ImportError:
    print("ERROR: pycryptodome がインストールされていません")
    sys.exit(1)

# ========== 暗号 ==========

def aes128_cmac(key: bytes, data: bytes) -> bytes:
    c = CMAC.new(key, ciphermod=AES)
    c.update(data)
    return c.digest()

def verify_sdm_mac(master_key_hex: str, uid_hex: str, ctr_value: int, mac_hex: str) -> bool:
    master_key = bytes.fromhex(master_key_hex)
    uid = bytes.fromhex(uid_hex)

    # 1. SV (Session Vector) の構築
    sv = bytearray(16)
    sv[0:6] = [0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80]
    sv[6:13] = uid
    sv[13:16] = ctr_value.to_bytes(3, byteorder='little')

    # 2. セッションキー K_ses_sdm_mac の導出 (master_key をベースとする)
    k_ses_sdm_mac = aes128_cmac(master_key, bytes(sv))

    # 3. 最終的な CMAC 計算 (ファイルデータは空なので、入力は空 b"")
    final_cmac = aes128_cmac(k_ses_sdm_mac, b"")

    # 4. NXP独自仕様: 奇数バイトのみを抽出 (1::2)
    calculated = final_cmac[1::2].hex().upper()
    received = mac_hex.upper()

    print(f"  計算MAC : {calculated}")
    print(f"  受信MAC : {received}")
    return calculated == received

# ========== APDU ==========

def send_apdu(conn, apdu):
    """APDUを送信してレスポンスを返す"""
    data, sw1, sw2 = conn.transmit(apdu)
    return data, sw1, sw2

def get_uid(conn):
    """UID を取得する (GET_DATA APDU)"""
    # NTAG 424 DNA: GetUID - FF CA 00 00 00
    apdu = [0xFF, 0xCA, 0x00, 0x00, 0x00]
    data, sw1, sw2 = send_apdu(conn, apdu)
    if sw1 == 0x90 and sw2 == 0x00:
        return bytes(data).hex().upper()
    return None

def read_ndef(conn):
    """NDEF Message を読み取る (PC/SC ISO7816-4 経由)"""
    # ステップ1: NDEF Application 選択
    select_ndef_app = [0x00, 0xA4, 0x04, 0x00, 0x07,
                       0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00]
    data, sw1, sw2 = send_apdu(conn, select_ndef_app)
    if not (sw1 == 0x90 and sw2 == 0x00):
        return None, f"NDEF Application 選択失敗: SW={sw1:02X}{sw2:02X}"

    # ステップ2: NDEF File 選択 (EF 0002)
    select_ndef_file = [0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x04]
    data, sw1, sw2 = send_apdu(conn, select_ndef_file)
    if not (sw1 == 0x90 and sw2 == 0x00):
        return None, f"NDEF File 選択失敗: SW={sw1:02X}{sw2:02X}"

    # ステップ3: NDEF データ長を読む (最初の2バイト)
    read_len = [0x00, 0xB0, 0x00, 0x00, 0x02]
    data, sw1, sw2 = send_apdu(conn, read_len)
    if not (sw1 == 0x90 and sw2 == 0x00):
        return None, f"NDEF 長さ読み取り失敗: SW={sw1:02X}{sw2:02X}"

    nlen = (data[0] << 8) | data[1]
    if nlen == 0:
        return None, "NDEFデータが空 (NLEN=0)"

    # ステップ4: NDEF Message 本体を読む
    read_data = [0x00, 0xB0, 0x00, 0x02, min(nlen, 0xEF)]
    data, sw1, sw2 = send_apdu(conn, read_data)
    if not (sw1 == 0x90 and sw2 == 0x00):
        return None, f"NDEFデータ読み取り失敗: SW={sw1:02X}{sw2:02X}"

    return bytes(data), None

def parse_ndef_uri(ndef_bytes: bytes):
    """NDEFメッセージからURIを取り出す（シンプルパーサ）"""
    # NDEF URI Record: TNF=0x01, Type='U' (0x55)
    # フォーマット: MB ME SR (flags) | type_length | payload_length | type ('U') | uri_id | uri...
    idx = 0
    uris = []
    while idx < len(ndef_bytes):
        if idx >= len(ndef_bytes):
            break
        flags = ndef_bytes[idx]; idx += 1
        tnf = flags & 0x07
        il = (flags >> 3) & 0x01   # ID Length present
        sr = (flags >> 4) & 0x01   # Short Record
        cf = (flags >> 5) & 0x01   # Chunk Flag
        me = (flags >> 6) & 0x01   # Message End
        mb = (flags >> 7) & 0x01   # Message Begin

        if idx >= len(ndef_bytes): break
        type_len = ndef_bytes[idx]; idx += 1

        if sr:
            if idx >= len(ndef_bytes): break
            payload_len = ndef_bytes[idx]; idx += 1
        else:
            if idx + 4 > len(ndef_bytes): break
            payload_len = int.from_bytes(ndef_bytes[idx:idx+4], 'big'); idx += 4

        if il:
            if idx >= len(ndef_bytes): break
            id_len = ndef_bytes[idx]; idx += 1
            idx += id_len  # ID をスキップ

        type_bytes = ndef_bytes[idx:idx+type_len]; idx += type_len
        payload = ndef_bytes[idx:idx+payload_len]; idx += payload_len

        # URI レコード (TNF=1, Type='U')
        if tnf == 0x01 and type_bytes == b'U' and payload:
            uri_id = payload[0]
            uri_prefixes = {
                0x00: '', 0x01: 'http://www.', 0x02: 'https://www.',
                0x03: 'http://', 0x04: 'https://', 0x05: 'tel:',
                0x06: 'mailto:', 0x07: 'ftp://anonymous:anonymous@',
                0x08: 'ftp://ftp.', 0x09: 'ftps://', 0x0A: 'sftp://',
                0x0B: 'smb://', 0x0C: 'nfs://', 0x0D: 'ftp://',
                0x0E: 'dav://', 0x0F: 'news:', 0x10: 'telnet://',
                0x11: 'imap:', 0x12: 'rtsp://', 0x13: 'urn:',
                0x14: 'pop:', 0x15: 'sip:', 0x16: 'sips:',
                0x17: 'tftp:', 0x18: 'btspp://', 0x19: 'btl2cap://',
                0x1A: 'btgoep://', 0x1B: 'tcpobex://', 0x1C: 'irdaobex://',
                0x1D: 'file://', 0x1E: 'urn:epc:id:', 0x1F: 'urn:epc:tag:',
                0x20: 'urn:epc:pat:', 0x21: 'urn:epc:raw:', 0x22: 'urn:epc:',
                0x23: 'urn:nfc:'
            }
            prefix = uri_prefixes.get(uri_id, '')
            uri_str = prefix + payload[1:].decode('utf-8', errors='replace')
            uris.append(uri_str)

        if me:
            break

    return uris

def parse_url_params(url: str) -> dict:
    params = {}
    if '?' in url:
        query = url.split('?', 1)[1]
        for part in query.split('&'):
            if '=' in part:
                k, v = part.split('=', 1)
                params[k.lower()] = v
    return params

# ========== メイン ==========

FACTORY_KEY = '00' * 16

def test_tag(reader):
    print(f"\nリーダー: {reader}")
    print("タグをかざしてください... (Ctrl+C で終了)\n")

    while True:
        try:
            conn = reader.createConnection()
            conn.connect()
        except Exception:
            time.sleep(0.5)
            continue

        try:
            print("=" * 55)
            print("  タグ検知！")
            print("=" * 55)

            # 1. UID取得
            uid = get_uid(conn)
            if uid:
                print(f"  UID        : {uid}")
            else:
                print("  UID取得失敗")

            # 2. NDEF読み取り
            print("\n  [NDEF読み取り中...]")
            ndef_bytes, err = read_ndef(conn)

            if err:
                print(f"  NDEF エラー: {err}")
            elif ndef_bytes:
                print(f"  NDEF生データ(HEX): {ndef_bytes.hex().upper()}")
                uris = parse_ndef_uri(ndef_bytes)

                if uris:
                    for uri in uris:
                        print(f"\n  URL: {uri}")
                        params = parse_url_params(uri)
                        uid_p = params.get('uid', '')
                        ctr_p = params.get('ctr', '')
                        mac_p = params.get('mac', '')

                        print("\n  [SUN パラメータ解析]")
                        if uid_p and ctr_p and mac_p:
                            print(f"  SUN パラメータ検出！")
                            print(f"    UID: {uid_p}")
                            print(f"    CTR: {ctr_p}")
                            print(f"    MAC: {mac_p}")
                            try:
                                ctr_int = int(ctr_p, 16)
                                print(f"    CTR (10進数): {ctr_int}")
                            except ValueError:
                                ctr_int = 0

                            print(f"\n  [MAC 検証 - デフォルトキー 0x00x16]")
                            try:
                                ok = verify_sdm_mac(FACTORY_KEY, uid_p, ctr_int, mac_p)
                                if ok:
                                    print("  ** MAC 検証成功! SUN機能は正常です **")
                                else:
                                    print("  ** MAC 検証失敗")
                                    print("     → 別のキーが設定されているか、URLフォーマットが違う可能性")
                            except Exception as e:
                                print(f"  MAC 検証エラー: {e}")
                        else:
                            print("  SUN パラメータ(uid/ctr/mac)はURLに含まれていません")
                            print("  → SDM(SUN)設定が必要か、静的URLのみのタグです")
                else:
                    print("  NDEFにURIレコードが見つかりませんでした")
            else:
                print("  NDEFデータなし")

        except Exception as e:
            print(f"  エラー: {e}")
        finally:
            try:
                conn.disconnect()
            except Exception:
                pass

        print("\n次のタグを待っています... (Ctrl+C で終了)\n")
        time.sleep(2.0)

def main():
    print("=" * 55)
    print(" NTAG 424 DNA SUN機能 テストツール (PC/SC版)")
    print("=" * 55)

    r_list = readers()
    if not r_list:
        print("エラー: PC/SCリーダーが見つかりません")
        sys.exit(1)

    print("接続済みリーダー:")
    for i, r in enumerate(r_list):
        print(f"  [{i}] {r}")

    reader = r_list[0]
    print(f"\n使用リーダー: {reader}")

    try:
        test_tag(reader)
    except KeyboardInterrupt:
        print("\n\nテスト終了")

if __name__ == '__main__':
    main()
