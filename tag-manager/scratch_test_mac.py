import binascii
from Crypto.Hash import CMAC
from Crypto.Cipher import AES

def aes128_cmac(key: bytes, data: bytes) -> bytes:
    c = CMAC.new(key, ciphermod=AES)
    c.update(data)
    return c.digest()

def get_nxp_sdm_mac(k_base: bytes, uid: bytes, ctr_value: int) -> str:
    """NXP公式仕様に基づく SDM MAC の計算 (奇数バイト切り出し)"""
    # 1. SV (Session Vector) の構築
    sv = bytearray(16)
    sv[0:6] = [0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80]
    sv[6:13] = uid
    sv[13:16] = ctr_value.to_bytes(3, byteorder='little')
    
    # 2. セッションキー K_ses_sdm_mac の導出
    k_ses_sdm_mac = aes128_cmac(k_base, bytes(sv))
    
    # 3. 空データに対する CMAC 計算
    final_cmac = aes128_cmac(k_ses_sdm_mac, b"")
    
    # 4. NXP独自ルール: 奇数バイトのみを抽出 (1::2)
    mac_bytes = final_cmac[1::2]
    return mac_bytes.hex().upper()

# テストデータ検証
all_0 = b"\x00" * 16

test_cases = [
    {
        "uid": "0474956A161690",
        "ctr": 3,
        "recv": "5B84D7B0DAE47211"
    },
    {
        "uid": "04271A82161690",
        "ctr": 41, # 0x29
        "recv": "3E430F3DC80AE006"
    },
    {
        "uid": "04271A82161690",
        "ctr": 42, # 0x2A
        "recv": "D8EBA4E8C133B648"
    }
]

with open("mac_result3.txt", "w", encoding="utf-8") as f:
    for i, tc in enumerate(test_cases, start=1):
        uid_bytes = bytes.fromhex(tc["uid"])
        calc = get_nxp_sdm_mac(all_0, uid_bytes, tc["ctr"])
        match = (calc == tc["recv"])
        f.write(f"テスト #{i} (UID={tc['uid']}, CTR={tc['ctr']}):\n")
        f.write(f"  計算MAC: {calc}\n")
        f.write(f"  受信MAC: {tc['recv']}\n")
        f.write(f"  一致: {match}\n\n")
