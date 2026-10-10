import jwt from 'jsonwebtoken';
import { input } from '../data.mjs';
import { revision } from './customer-token.revision.mjs';
export async function handler(event = {}) {
  const { customerId = 'customer-7' } = input(event);
  const token = jwt.sign({ sub: customerId, iat: 1736942400, exp: 1736946000 }, 'fixture-only-not-a-secret', { algorithm: 'HS256' });
  const decoded = jwt.verify(token, 'fixture-only-not-a-secret', { clockTimestamp: 1736943000 });
  return { revision, customerId: decoded.sub, expiresAt: decoded.exp, token };
}
