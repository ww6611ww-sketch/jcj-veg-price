// 檔案型資料庫。正式（official）與測試（test）分在不同目錄，互不讀寫。
// 冪等：同一 (來源, 日期, 市場, 原始品名, 價格類型) 重跑只會更新，不會重複。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATASETS = ['official', 'test'];

export class Store {
  constructor(root, dataset) {
    if (!DATASETS.includes(dataset)) throw new Error(`未知資料集 ${dataset}`);
    this.dir = path.join(root, dataset);
    this.dataset = dataset;
    fs.mkdirSync(path.join(this.dir, 'raw'), { recursive: true });
    this.file = path.join(this.dir, 'records.json');
    this.statusFile = path.join(this.dir, 'status.json');
    this.records = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
    this.status = fs.existsSync(this.statusFile) ? JSON.parse(fs.readFileSync(this.statusFile, 'utf8')) : {};
  }
  static key(r) { return [r.source, r.date, r.market, r.rawItemName, r.priceType].join('|'); }

  saveRaw(source, content, ext, fetchedAt) {
    const sha = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
    const day = fetchedAt.slice(0, 10);
    const p = path.join(this.dir, 'raw', source, day);
    fs.mkdirSync(p, { recursive: true });
    const f = path.join(p, `${fetchedAt.replace(/[:.]/g, '')}-${sha}.${ext}`);
    fs.writeFileSync(f, content);
    return path.relative(this.dir, f);
  }

  /** 以單一交易寫入：先寫暫存檔再 rename，失敗時原檔不動（保留最後一次有效資料）。 */
  /**
   * 冪等寫入。回傳 inserted（新鍵）、changed（同鍵但價格或排除／標記狀態改變）、unchanged（完全相同，只更新抓取時間）。
   * 先寫暫存檔再 rename，失敗時原檔不動（保留最後一次有效資料）。
   */
  upsert(records, meta) {
    let inserted = 0, changed = 0, unchanged = 0;
    const next = { ...this.records };
    for (const r of records) {
      const k = Store.key(r), old = next[k];
      if (!old) inserted++;
      else if (old.price !== r.price || (old.excluded ?? null) !== (r.excluded ?? null) || (old.flag ?? null) !== (r.flag ?? null)) changed++;
      else { unchanged++; continue; } // 完全相同：保留原紀錄（含首次取得時間與原始檔），避免每次抓取都改寫檔案
      next[k] = { ...r, ...meta, dataset: this.dataset };
    }
    if (inserted || changed) this.#write(next);
    return { inserted, changed, unchanged, updated: changed + unchanged };
  }

  /** 只保留 minDate（含）之後的紀錄，避免存放庫無限長大。原始檔另存於 Actions artifact。 */
  prune(minDate) {
    const next = Object.fromEntries(Object.entries(this.records).filter(([, r]) => r.date >= minDate));
    const removed = Object.keys(this.records).length - Object.keys(next).length;
    if (removed) this.#write(next);
    return removed;
  }
  latestDate(source) { return Object.values(this.records).reduce((m, r) => (r.source === source && !r.excluded && r.date > m ? r.date : m), '') || null; }
  #write(next) {
    // 一筆一行、依鍵排序：仍是合法 JSON，git 每日只存差異
    const tmp = this.file + '.tmp';
    const keys = Object.keys(next).sort();
    fs.writeFileSync(tmp, '{\n' + keys.map(k => JSON.stringify(k) + ':' + JSON.stringify(next[k])).join(',\n') + '\n}\n');
    fs.renameSync(tmp, this.file);
    this.records = next;
  }

  setStatus(source, patch) {
    this.status[source] = { ...(this.status[source] || {}), ...patch };
    fs.writeFileSync(this.statusFile, JSON.stringify(this.status, null, 2));
  }
  all() { return Object.values(this.records); }
}
