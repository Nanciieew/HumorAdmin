// Trusted local admin tool. Amounts are integer USD cents, never dollars/floating point.
import { createClient } from '@supabase/supabase-js';
const [command, ...args] = process.argv.slice(2);
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? '');
const cents = value => /^\d+$/.test(value ?? '') && Number.isSafeInteger(Number(value));
const usage = 'Usage: sale IMAGE_ID AMOUNT_CENTS REFERENCE [SOLD_AT_ISO] | refund SALE_ID TOTAL_REFUNDED_CENTS | price IMAGE_ID PRICE_CENTS';
try {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error('Configure Supabase URL and server secret in .env.local.');
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let result;
  if (command === 'sale') {
    const [image, amount, reference, date] = args;
    if (args.length < 3 || args.length > 4 || !uuid(image) || !cents(amount) || Number(amount) <= 0 || !reference.trim() || reference.trim().length > 200 ||
      (date && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date))))) throw new Error(usage);
    result = await client.rpc('record_image_sale', { p_image_id: image, p_amount_cents: amount, p_reference: reference.trim(), p_sold_at: date ?? null });
  } else if (command === 'refund') {
    const [sale, amount] = args;
    if (args.length !== 2 || !uuid(sale) || !cents(amount)) throw new Error(usage);
    result = await client.rpc('record_image_refund', { p_sale_id: sale, p_refunded_cents: amount });
  } else if (command === 'price') {
    const [image, amount] = args;
    if (args.length !== 2 || !uuid(image) || !cents(amount) || Number(amount) <= 0) throw new Error(usage);
    result = await client.from('images').update({ price_cents: amount }).eq('id', image).select('id').single();
  } else throw new Error(usage);
  if (result.error) throw new Error(result.error.message);
  console.log(command === 'sale' ? `Sale recorded: ${result.data}` : `${command} saved.`);
} catch (error) { console.error(error instanceof Error ? error.message : 'Admin operation failed.'); process.exitCode = 1; }
