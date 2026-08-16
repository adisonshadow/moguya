/**
 * 仅用于渲染进程：生成 ZIP（压缩方式 STORED=0），不依赖 Node fs / adm-zip。
 * 满足 ODF 包（如 ODG）对「首项 mimetype + 若干 XML/二进制」的常见需求。
 */

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeU16(dv: DataView, o: number, v: number) {
  dv.setUint16(o, v, true);
}

function writeU32(dv: DataView, o: number, v: number) {
  dv.setUint32(o, v, true);
}

export type ZipStoreEntry = { path: string; data: Uint8Array };

/** 按 entries 顺序写入本地头与数据；路径须为 ASCII（ODF 常用路径均满足） */
export function buildZipStoreOnly(entries: ZipStoreEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  const dosNow = () => {
    const d = new Date();
    let t = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
    const y = Math.max(d.getFullYear() - 1980, 0);
    let dt = ((y << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
    return { t, dt };
  };
  const { t: dosTime, dt: dosDate } = dosNow();

  for (const { path, data } of entries) {
    const nameBytes = enc.encode(path);
    const crc = crc32(data);
    const size = data.length;
    const localSize = 30 + nameBytes.length + size;

    const local = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(local.buffer);
    writeU32(ldv, 0, 0x04034b50);
    writeU16(ldv, 4, 20);
    writeU16(ldv, 6, 0);
    writeU16(ldv, 8, 0);
    writeU16(ldv, 10, dosTime);
    writeU16(ldv, 12, dosDate);
    writeU32(ldv, 14, crc);
    writeU32(ldv, 18, size);
    writeU32(ldv, 22, size);
    writeU16(ldv, 26, nameBytes.length);
    writeU16(ldv, 28, 0);
    local.set(nameBytes, 30);

    chunks.push(local, data);

    const cent = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(cent.buffer);
    writeU32(cdv, 0, 0x02014b50);
    writeU16(cdv, 4, 0x0314);
    writeU16(cdv, 6, 20);
    writeU16(cdv, 8, 0);
    writeU16(cdv, 10, 0);
    writeU16(cdv, 12, dosTime);
    writeU16(cdv, 14, dosDate);
    writeU32(cdv, 16, crc);
    writeU32(cdv, 20, size);
    writeU32(cdv, 24, size);
    writeU16(cdv, 28, nameBytes.length);
    writeU16(cdv, 30, 0);
    writeU16(cdv, 32, 0);
    writeU16(cdv, 34, 0);
    writeU16(cdv, 36, 0);
    writeU32(cdv, 38, 0);
    writeU32(cdv, 42, offset);
    cent.set(nameBytes, 46);
    centralChunks.push(cent);

    offset += localSize;
  }

  const centralSize = centralChunks.reduce((s, u) => s + u.length, 0);
  const centralOffset = offset;
  for (const c of centralChunks) chunks.push(c);

  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  writeU32(edv, 0, 0x06054b50);
  writeU16(edv, 4, 0);
  writeU16(edv, 6, 0);
  writeU16(edv, 8, entries.length);
  writeU16(edv, 10, entries.length);
  writeU32(edv, 12, centralSize);
  writeU32(edv, 16, centralOffset);
  writeU16(edv, 20, 0);
  chunks.push(eocd);

  const total = chunks.reduce((s, u) => s + u.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
