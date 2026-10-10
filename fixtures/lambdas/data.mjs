export const products = [
  { id: 'coffee', name: 'Coffee beans', price: '12.50', stock: 40, category: 'grocery' },
  { id: 'mug', name: 'Ceramic mug', price: '8.00', stock: 12, category: 'home' },
  { id: 'tea', name: 'Green tea', price: '6.25', stock: 25, category: 'grocery' }
];
export const order = { id: 'order-100', customerId: 'customer-7', email: 'alex@example.test', placedAt: '2025-01-15T12:00:00Z', lines: [{ productId: 'coffee', quantity: 2 }, { productId: 'mug', quantity: 1 }] };
export const amount = (lines) => lines.reduce((sum, line) => sum + Number(products.find(p => p.id === line.productId).price) * line.quantity, 0);
export function input(event = {}) { return typeof event.body === 'string' ? JSON.parse(event.body) : (event.body ?? event); }
