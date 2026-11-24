import { paiseToInput, rupeesToPaise } from './money';

// Price lists for the bulk price update: read a CSV (from Excel, a distributor, or our own
// download) or rows pasted straight from Excel (which arrive tab-separated), and write the
// shop's current prices as a CSV to edit.

// Excel writes (and wants) a byte-order mark at the start of a UTF-8 CSV file.
const BOM = String.fromCharCode(0xfeff);

export type PriceRow = { name?: string; barcode?: string; pricePaise: number; mrpPaise?: number | null };

// Column titles people actually use, lowercased.
const COLUMNS = {
  name: ['name', 'product', 'product name', 'item', 'item name'],
  barcode: ['barcode', 'ean', 'code', 'bar code'],
  price: ['price', 'selling price', 'sale price', 'rate', 'sp'],
  mrp: ['mrp'],
};

// Splits one line, honouring "quoted, values" (Excel quotes any cell containing a comma).
function cells(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

export function parsePriceList(text: string): { rows: PriceRow[]; problems: string[] } {
  const lines = (text.startsWith(BOM) ? text.slice(1) : text).split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { rows: [], problems: ['The list is empty.'] };
  const delimiter = lines[0].includes('\t') ? '\t' : ',';

  // With a header row, columns are found by title; without one, the order is name, price, mrp.
  const header = cells(lines[0], delimiter).map((h) => h.toLowerCase());
  const find = (names: string[]) => header.findIndex((h) => names.includes(h));
  const hasHeader = find(COLUMNS.price) >= 0;
  const col = hasHeader
    ? { name: find(COLUMNS.name), barcode: find(COLUMNS.barcode), price: find(COLUMNS.price), mrp: find(COLUMNS.mrp) }
    : { name: 0, barcode: -1, price: 1, mrp: 2 };

  const rows: PriceRow[] = [];
  const problems: string[] = [];
  lines.slice(hasHeader ? 1 : 0).forEach((line, i) => {
    const lineNo = i + (hasHeader ? 2 : 1);
    const c = cells(line, delimiter);
    const name = col.name >= 0 ? c[col.name] : '';
    const barcode = col.barcode >= 0 ? c[col.barcode] : '';
    if (!name && !barcode) return problems.push(`Line ${lineNo}: no product name or barcode.`);
    const pricePaise = rupeesToPaise(c[col.price] ?? '');
    if (pricePaise === null) return problems.push(`Line ${lineNo}: "${c[col.price] ?? ''}" is not a valid price.`);
    const mrpText = col.mrp >= 0 ? (c[col.mrp] ?? '') : '';
    // An empty MRP cell keeps the MRP already saved.
    const mrpPaise = mrpText ? rupeesToPaise(mrpText) : undefined;
    if (mrpPaise === null) return problems.push(`Line ${lineNo}: "${mrpText}" is not a valid MRP.`);
    rows.push({ ...(name ? { name } : {}), ...(barcode ? { barcode } : {}), pricePaise, ...(mrpPaise !== undefined ? { mrpPaise } : {}) });
  });
  return { rows, problems };
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toPriceListCsv(products: { name: string; barcode: string | null; pricePaise: number; mrpPaise: number | null }[]): string {
  const lines = products.map((p) =>
    [p.name, p.barcode ?? '', paiseToInput(p.pricePaise), p.mrpPaise === null ? '' : paiseToInput(p.mrpPaise)].map(csvCell).join(','),
  );
  // The BOM makes Excel open the file as UTF-8.
  return `${BOM}Name,Barcode,Price,MRP\n${lines.join('\n')}\n`;
}
