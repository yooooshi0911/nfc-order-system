import crypto from 'crypto';

const Rb = Buffer.from('00000000000000000000000000000087', 'hex');

function shiftLeft(buffer: Buffer): Buffer {
    const result = Buffer.alloc(buffer.length);
    let overflow = 0;
    for (let i = buffer.length - 1; i >= 0; i--) {
        const current = buffer[i];
        result[i] = ((current << 1) | overflow) & 0xff;
        overflow = (current & 0x80) ? 1 : 0;
    }
    return result;
}

function xor(buffer1: Buffer, buffer2: Buffer): Buffer {
    const result = Buffer.alloc(buffer1.length);
    for (let i = 0; i < buffer1.length; i++) {
        result[i] = buffer1[i] ^ buffer2[i];
    }
    return result;
}

function aes128(key: Buffer, data: Buffer): Buffer {
    const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(data), cipher.final()]) as Buffer;
}

function generateSubkeys(key: Buffer): { K1: Buffer; K2: Buffer } {
    const zero = Buffer.alloc(16);
    const L = aes128(key, zero);
    
    let K1 = shiftLeft(L);
    if (L[0] & 0x80) {
        K1 = xor(K1, Rb);
    }
    
    let K2 = shiftLeft(K1);
    if (K1[0] & 0x80) {
        K2 = xor(K2, Rb);
    }
    
    return { K1, K2 };
}

export function aes128Cmac(key: Buffer, message: Buffer): Buffer {
    const { K1, K2 } = generateSubkeys(key);
    
    const blockCount = Math.ceil(message.length / 16);
    let lastBlockIsComplete = false;
    
    if (blockCount === 0) {
        const padded = Buffer.alloc(16);
        padded[0] = 0x80;
        const lastBlock = xor(padded, K2);
        return aes128(key, lastBlock) as any;
    } else {
        lastBlockIsComplete = (message.length % 16 === 0);
    }
    
    let lastBlock: Buffer;
    if (lastBlockIsComplete) {
        lastBlock = xor(message.slice((blockCount - 1) * 16) as any, K1) as any;
    } else {
        const partial = message.slice((blockCount - 1) * 16) as any;
        const padded = Buffer.alloc(16);
        partial.copy(padded);
        padded[partial.length] = 0x80;
        lastBlock = xor(padded, K2) as any;
    }
    
    let x: any = Buffer.alloc(16);
    for (let i = 0; i < blockCount - 1; i++) {
        const y = xor(x, message.slice(i * 16, (i + 1) * 16) as any) as any;
        x = aes128(key, y);
    }
    
    const y = xor(x, lastBlock) as any;
    return aes128(key, y) as any;
}

/**
 * マスターキーとUIDから、該当タグ専用の個別暗号キー (K_child) を生成する
 */
export function getChildKey(masterKey: Buffer, uid: Buffer): Buffer {
    return aes128Cmac(masterKey, uid);
}

/**
 * 個別キー、UID、カウンターから SDM MAC を計算する (先頭8バイトの16進文字列)
 */
export function calculateSdmMac(childKey: Buffer, uid: Buffer, ctrValue: number): string {
    // 1. SV (Session Vector) の構築
    const sv = Buffer.alloc(16);
    sv.set([0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80], 0);
    sv.set(uid, 6);
    
    const ctrBytes = Buffer.alloc(3);
    ctrBytes.writeUIntLE(ctrValue, 0, 3); // 3バイトリトルエンディアン
    sv.set(ctrBytes, 13);
    
    // 2. セッションキー K_ses_sdm_mac の導出
    const kSesSdmMac = aes128Cmac(childKey, sv);
    
    // 3. 最終的な CMAC 計算 (ファイルデータは空なので、入力は空)
    const finalCmac = aes128Cmac(kSesSdmMac, Buffer.alloc(0));
    
    // 4. NXP独自仕様: 奇数バイトのみを抽出 (1, 3, 5, 7, 9, 11, 13, 15)
    const macBytes = Buffer.alloc(8);
    for (let i = 0; i < 8; i++) {
        macBytes[i] = finalCmac[1 + i * 2];
    }
    
    return macBytes.toString('hex').toUpperCase();
}

/**
 * 受信した UID, Counter, MAC が正しいかどうか検証する
 * @param masterKeyHex 環境変数からロードしたマスターソースキー(32文字の16進数)
 * @param uidHex リクエストパラメータの UID (14文字の16進数)
 * @param ctrValue リクエストパラメータの Counter (数値)
 * @param macHexToVerify 検証対象の MAC (16文字の16進数)
 */
export function verifySdmMac(
    masterKeyHex: string,
    uidHex: string,
    ctrValue: number,
    macHexToVerify: string
): boolean {
    try {
        const masterKey = Buffer.from(masterKeyHex, 'hex');
        const uid = Buffer.from(uidHex, 'hex');
        
        // 1. 個別鍵の算出 (本番用)
        const childKey = getChildKey(masterKey, uid);
        const expectedMacDerived = calculateSdmMac(childKey, uid, ctrValue);
        
        if (expectedMacDerived === macHexToVerify.toUpperCase()) {
            return true;
        }
        
        // 2. フォールバック: 工場出荷時キー (開発用) での検証
        const defaultKey = Buffer.alloc(16, 0); // 16 bytes of 0x00
        const expectedMacDefault = calculateSdmMac(defaultKey, uid, ctrValue);
        
        if (expectedMacDefault === macHexToVerify.toUpperCase()) {
            return true;
        }
        
        return false;
    } catch (e) {
        console.error("CMAC Verification error:", e);
        return false;
    }
}
