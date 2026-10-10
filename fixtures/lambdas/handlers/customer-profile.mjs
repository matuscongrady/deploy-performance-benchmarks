import { z } from 'zod';
import validator from 'validator';
import { input } from '../data.mjs';
import { revision } from './customer-profile.revision.mjs';
export async function handler(event = {}) {
  const request = z.object({ email: z.string().default('Alex@Example.test'), name: z.string().default('Alex') }).parse(input(event));
  if (!validator.isEmail(request.email)) throw new Error('Invalid email');
  return { revision, name: validator.escape(request.name), email: request.email.toLowerCase() };
}
