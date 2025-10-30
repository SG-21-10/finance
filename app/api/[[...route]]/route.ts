import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { clerkMiddleware, getAuth } from '@hono/clerk-auth';

// Import individual route handlers
import plaid from './plaid';
import summary from './summary';
import accounts from './accounts';
import categories from './categories';
import transactions from './transactions';
import subscriptions from './subscriptions';
import recommendations from './recommendations';

// Set runtime to Node.js
export const runtime = 'nodejs';

// Create Hono app
const app = new Hono().basePath('/api');

// --- Clerk Middleware Setup (Keep As Is) ---
const clerkOptions = {
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY, // Server-side key
  encryptionKey: process.env.CLERK_ENCRYPTION_KEY,
};
if (!clerkOptions.secretKey || !clerkOptions.publishableKey || !clerkOptions.encryptionKey) {
  console.error('CRITICAL ERROR: Clerk API keys are missing!');
} else {
  console.log('Clerk API keys loaded for API middleware.');
}
app.use('*', clerkMiddleware(clerkOptions));
// --- End Clerk Middleware ---


// --- Explicitly connect each route ---
app.route('/plaid', plaid);
app.route('/summary', summary);
app.route('/accounts', accounts);
app.route('/categories', categories);
app.route('/transactions', transactions);
app.route('/subscriptions', subscriptions);
app.route('/recommendations', recommendations);


console.log('Explicitly connected API routes.');

// --- Test Route (Optional - can be removed later) ---
app.get('/test-auth', (c) => {
  const auth = getAuth(c);
  if (!auth?.userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  console.log('Authenticated API Test Route Hit!');
  return c.json({ message: 'API Route Authenticated!', userId: auth.userId }, 200);
});
// --- End Test Route ---


// --- Fallback 404 Handler ---
// This should NOT be hit if routes are connected correctly
app.all('*', (c) => {
  console.log(`Fallback 404 Hit: ${c.req.method} ${c.req.url}`);
  return c.json({ error: 'Not Found - Fallback' }, 404);
});
// --- End Fallback ---


// Export handlers for Vercel/Next.js
export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const PUT = handle(app);
export const OPTIONS = handle(app);

console.log('API route handler initialized with explicit routes.');

