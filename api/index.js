import { createApiHandler } from '../server/app.js';
import { SheetDatabase } from '../server/storage.js';

const db = new SheetDatabase();
const handleApi = createApiHandler(db);

export default async function handler(req, res) {
  const parsed = new URL(req.url || '/', 'http://localhost');
  const rewrittenPath = parsed.searchParams.get('__path');
  if (rewrittenPath !== null) {
    parsed.searchParams.delete('__path');
    const qs = parsed.searchParams.toString();
    req.url = `/api/${rewrittenPath}${qs ? `?${qs}` : ''}`;
  }
  return handleApi(req, res);
}
