// Shared helpers for order data stored in localStorage, plus backup/export and cost math.

// Every localStorage key the app writes. Backups include all of them.
const STORAGE_KEYS = ['orders', 'item_list', 'item_qty_map', 'item_price_map', 'supplier_list', 'order_supplier'];
const BACKUP_VERSION = 1;

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function loadOrders() {
  const orders = readJSON('orders', []);
  return Array.isArray(orders) ? orders : [];
}

export function loadPriceMap() {
  return readJSON('item_price_map', {});
}

export function savePriceMap(map) {
  localStorage.setItem('item_price_map', JSON.stringify(map));
}

// ---- Cost math ----

export function lineTotal(item) {
  const price = Number(item.price);
  const qty = Number(item.qty);
  if (!Number.isFinite(price) || !Number.isFinite(qty)) return 0;
  return price * qty;
}

export function orderTotal(order) {
  return (order.items || []).reduce((sum, item) => sum + lineTotal(item), 0);
}

export function hasPrice(item) {
  return item.price !== undefined && item.price !== null && item.price !== '' && Number.isFinite(Number(item.price));
}

export function formatMoney(value) {
  return '$' + Number(value || 0).toFixed(2);
}

// Percent change of the item's price vs the price paid last time, or null if unknown.
export function priceChangePct(item) {
  if (!hasPrice(item) || !hasPrice({ price: item.prevPrice }) || Number(item.prevPrice) === 0) return null;
  return ((Number(item.price) - Number(item.prevPrice)) / Number(item.prevPrice)) * 100;
}

// Spending on SENT orders for one month ('YYYY-MM'), grouped by supplier, largest first.
export function monthlySpend(orders, month) {
  const bySupplier = {};
  orders
    .filter(o => o.status === 'SENT' && (o.orderDate || '').slice(0, 7) === month)
    .forEach(o => {
      const name = o.supplier || '(No supplier)';
      bySupplier[name] = (bySupplier[name] || 0) + orderTotal(o);
    });
  const rows = Object.entries(bySupplier)
    .map(([supplier, total]) => ({ supplier, total }))
    .sort((a, b) => b.total - a.total);
  return { rows, total: rows.reduce((sum, r) => sum + r.total, 0) };
}

// ---- Backup / export ----

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const today = () => new Date().toISOString().slice(0, 10);

export function exportBackup() {
  const data = {};
  STORAGE_KEYS.forEach(key => {
    const raw = localStorage.getItem(key);
    if (raw !== null) data[key] = key === 'order_supplier' ? raw : readJSON(key, null);
  });
  const backup = { app: 'pos-togo-dashboard', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
  downloadFile(`orderpad-backup-${today()}.json`, JSON.stringify(backup, null, 2), 'application/json');
}

function mergeUnique(current, incoming) {
  const result = [...current];
  incoming.forEach(v => {
    if (!result.includes(v)) result.push(v);
  });
  return result;
}

// Merges a backup into current data. Orders with the same id are replaced by the backup copy;
// nothing that exists only on this device is deleted. Returns the number of orders imported.
export function importBackup(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON');
  }
  const data = backup && backup.data;
  if (!data || typeof data !== 'object' || !Array.isArray(data.orders || [])) {
    throw new Error('File is not an OrderPad backup');
  }

  const incomingOrders = data.orders || [];
  const incomingIds = new Set(incomingOrders.map(o => o.id));
  const kept = loadOrders().filter(o => !incomingIds.has(o.id));
  localStorage.setItem('orders', JSON.stringify([...incomingOrders, ...kept]));

  ['item_list', 'supplier_list'].forEach(key => {
    if (Array.isArray(data[key])) {
      localStorage.setItem(key, JSON.stringify(mergeUnique(readJSON(key, []), data[key])));
    }
  });
  ['item_qty_map', 'item_price_map'].forEach(key => {
    if (data[key] && typeof data[key] === 'object') {
      localStorage.setItem(key, JSON.stringify({ ...readJSON(key, {}), ...data[key] }));
    }
  });
  if (typeof data.order_supplier === 'string' && localStorage.getItem('order_supplier') === null) {
    localStorage.setItem('order_supplier', data.order_supplier);
  }
  return incomingOrders.length;
}

function csvCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per item, ready for Excel or Google Sheets.
export function exportCSV(orders) {
  const header = ['Order ID', 'Order Date', 'Purchase By', 'Status', 'Supplier', 'Item', 'Qty', 'Unit', 'Unit Price', 'Line Total', 'Need Call'];
  const rows = [header];
  orders.forEach(o => {
    (o.items || []).forEach(item => {
      rows.push([
        o.id,
        o.orderDate,
        o.purchaseByDate,
        o.status,
        o.supplier,
        item.name,
        item.qty,
        item.unit,
        hasPrice(item) ? Number(item.price).toFixed(2) : '',
        hasPrice(item) ? lineTotal(item).toFixed(2) : '',
        item.needCall ? 'yes' : '',
      ]);
    });
  });
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  // BOM so Excel opens Thai text as UTF-8
  downloadFile(`orders-${today()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}
