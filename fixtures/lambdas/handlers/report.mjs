import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, Table, TableRow, TableCell } from 'docx';
import { products, order, amount } from '../data.mjs';
import { revision } from './report.revision.mjs';
export async function handler(event = {}) {
  const pdf = new PDFDocument({ info: { Title: 'Daily sales', CreationDate: new Date('2025-01-15T00:00:00Z') } });
  const parts = [];
  const finished = new Promise((resolve, reject) => { pdf.on('data', chunk => parts.push(chunk)); pdf.on('end', () => resolve(Buffer.concat(parts))); pdf.on('error', reject); });
  pdf.text(`Sales report: ${order.id}`);
  for (const line of order.lines) pdf.text(`${products.find(p => p.id === line.productId).name}: ${line.quantity}`);
  pdf.text(`Total: ${amount(order.lines).toFixed(2)}`); pdf.end();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sales'); sheet.addRow(['Product', 'Quantity', 'Unit price']);
  for (const line of order.lines) sheet.addRow([line.productId, line.quantity, Number(products.find(p => p.id === line.productId).price)]);
  const document = new Document({ sections: [{ children: [new Paragraph('Daily sales'), new Table({ rows: order.lines.map(line => new TableRow({ children: [new TableCell({ children: [new Paragraph(line.productId)] }), new TableCell({ children: [new Paragraph(String(line.quantity))] })] })) })] }] });
  const [pdfBytes, spreadsheet, wordDocument] = await Promise.all([finished, workbook.xlsx.writeBuffer(), Packer.toBuffer(document)]);
  return { revision, total: amount(order.lines).toFixed(2), files: [{ type: 'pdf', bytes: pdfBytes.length, prefix: pdfBytes.subarray(0, 4).toString() }, { type: 'xlsx', bytes: spreadsheet.length, prefix: Buffer.from(spreadsheet).subarray(0, 2).toString() }, { type: 'docx', bytes: wordDocument.length, prefix: wordDocument.subarray(0, 2).toString() }] };
}
