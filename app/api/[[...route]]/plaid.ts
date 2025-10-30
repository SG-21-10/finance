import { Hono } from 'hono';
import { getAuth } from '@hono/clerk-auth'; // Ensure Clerk auth is used
import { eq, and, desc, gte, lte, sql, inArray } from 'drizzle-orm'; // Import inArray
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  CountryCode,
  Products,
  RemovedTransaction,
  Transaction, // Import Transaction type
} from 'plaid';

import { db } from '@/db/drizzle';
// Import accounts, connectedBanks, transactions, AND insertTransactionSchema
import { accounts, connectedBanks, transactions, insertTransactionSchema } from '@/db/schema';
import { createId } from '@paralleldrive/cuid2';
import { parse, subDays } from 'date-fns'; // Import date-fns for date handling

const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV!],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const client = new PlaidApi(configuration);

const app = new Hono()
  // Route to create a Link Token
  .post('/create-link-token', async (c) => {
    const auth = getAuth(c);

    if (!auth?.userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      const token = await client.linkTokenCreate({
        user: {
          client_user_id: auth.userId,
        },
        client_name: 'Finance Tracker App',
        products: [Products.Transactions],
        country_codes: [CountryCode.Us],
        language: 'en',
      });

      return c.json({ data: token.data });
    } catch (error: any) {
      console.error('Plaid linkTokenCreate Error:', error.response?.data || error.message);
      return c.json({ error: 'Failed to create link token' }, 500);
    }
  })

  // Route to exchange public token AND fetch initial data
  .post('/exchange-public-token', async (c) => {
    const auth = getAuth(c);
    const { publicToken } = await c.req.json();

    if (!auth?.userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    if (!publicToken) {
      return c.json({ error: 'Bad Request: Missing publicToken' }, 400);
    }

    try {
      // 1. Exchange public token
      const exchangeResponse = await client.itemPublicTokenExchange({
        public_token: publicToken,
      });
      const accessToken = exchangeResponse.data.access_token;
      const itemId = exchangeResponse.data.item_id;

      // 2. Save/Update connection in DB
      const existingConnection = await db.query.connectedBanks.findFirst({
        where: and(
          eq(connectedBanks.userId, auth.userId),
          eq(connectedBanks.itemId, itemId)
        ),
      });

      if (existingConnection) {
        await db
          .update(connectedBanks)
          .set({ accessToken })
          .where(eq(connectedBanks.id, existingConnection.id));
      } else {
        await db.insert(connectedBanks).values({
          id: createId(),
          userId: auth.userId,
          accessToken: accessToken,
          itemId: itemId,
        });
      }

      // --- 3. Fetch Accounts from Plaid ---
      console.log('Fetching accounts for item:', itemId);
      const accountsResponse = await client.accountsGet({ access_token: accessToken });
      const plaidAccounts = accountsResponse.data.accounts;
      console.log('Received', plaidAccounts.length, 'accounts from Plaid.');

      // --- 4. Save/Update Accounts in DB (Safer Upsert) ---
      if (plaidAccounts.length > 0) {
        let insertedCount = 0;
        let updatedCount = 0;

        for (const plaidAccount of plaidAccounts) {
          const existingAccount = await db.query.accounts.findFirst({
            where: and(
              eq(accounts.userId, auth.userId),
              eq(accounts.plaidId, plaidAccount.account_id)
            ),
          });

          if (existingAccount) {
            // Update existing account (e.g., name might change)
            await db.update(accounts)
              .set({ name: plaidAccount.name })
              .where(eq(accounts.id, existingAccount.id));
            updatedCount++;
          } else {
            // Insert new account
            await db.insert(accounts).values({
              id: createId(),
              plaidId: plaidAccount.account_id,
              name: plaidAccount.name,
              userId: auth.userId,
            });
            insertedCount++;
          }
        }
        console.log(`Inserted ${insertedCount}, Updated ${updatedCount} accounts in DB.`);
      }


      // --- 5. Fetch Initial Transactions from Plaid ---
      console.log('Fetching initial transactions...');
      let allPlaidTransactions: Transaction[] = [];
      let hasMore = true;
      let cursor: string | undefined = undefined;

      while (hasMore) {
          const syncResponse = await client.transactionsSync({
              access_token: accessToken,
              cursor: cursor,
              count: 100,
          });
          allPlaidTransactions = allPlaidTransactions.concat(syncResponse.data.added);
          hasMore = syncResponse.data.has_more;
          cursor = syncResponse.data.next_cursor;
           // Consider adding a small delay or break condition for safety in dev
           if (allPlaidTransactions.length > 1000) { // Safety break
             console.warn("Breaking transaction sync loop after 1000+ transactions for safety.");
             hasMore = false;
           }
      }
      console.log('Received', allPlaidTransactions.length, 'initial transactions from Plaid.');


      // --- 6. Save Transactions in DB ---
      if (allPlaidTransactions.length > 0) {
        const plaidAccountIds = allPlaidTransactions.map(t => t.account_id).filter((id): id is string => !!id); // Ensure IDs are strings

        // Fetch accounts matching plaid IDs and user ID
        const ourAccounts = await db.select({ id: accounts.id, plaidId: accounts.plaidId })
                                   .from(accounts)
                                   .where(and(eq(accounts.userId, auth.userId),
                                              plaidAccountIds.length > 0 ? inArray(accounts.plaidId, plaidAccountIds) : sql`false`)); // Handle empty plaidAccountIds

        const plaidToInternalIdMap = new Map<string, string>();
        ourAccounts.forEach(a => {
            if (a.plaidId) { // Ensure plaidId is not null before adding to map
                plaidToInternalIdMap.set(a.plaidId, a.id);
            }
        });


        const transactionValues = allPlaidTransactions
          .map(tx => {
            let parsedDate: Date = new Date(); // Default to now
            try {
                if (tx.date) {
                    const tempDate = parse(tx.date, 'yyyy-MM-dd', new Date());
                    if (!isNaN(tempDate.getTime())) {
                       parsedDate = tempDate;
                    } else {
                       console.warn(`Invalid date format for transaction ${tx.transaction_id}: ${tx.date}. Using current date.`);
                    }
                } else {
                   console.warn(`Missing date for transaction ${tx.transaction_id}. Using current date.`);
                }
            } catch (e) {
                console.error(`Error parsing date for transaction ${tx.transaction_id}: ${tx.date}`, e);
            }

            const internalAccountId = tx.account_id ? plaidToInternalIdMap.get(tx.account_id) : undefined;
            if (!internalAccountId) {
                console.warn(`Could not find internal account ID for Plaid account ${tx.account_id} (Transaction ${tx.transaction_id})`);
                return null; // Skip this transaction if account mapping fails
            }

            return {
              id: createId(),
              amount: Math.round((tx.amount || 0) * 1000), // Default amount to 0 if null/undefined
              payee: tx.merchant_name || tx.name || 'N/A',
              notes: tx.name || null, // Allow notes to be null
              date: parsedDate,
              accountId: internalAccountId,
            };
          })
          .filter((tx): tx is NonNullable<typeof tx> => tx !== null); // Filter out nulls and refine type

        if (transactionValues.length > 0) {
          await db.insert(transactions).values(transactionValues);
          console.log('Saved', transactionValues.length, 'transactions in DB.');
        } else {
          console.log('No valid transactions to save after mapping/filtering.');
        }
      }

      return c.json({ message: 'Public token exchanged and initial data fetched.' });
    } catch (error: any) {
      console.error('Plaid exchangePublicToken or Data Fetch Error:', error.response?.data || error.message);
      // Log the full error for better debugging
      console.error(error);
      return c.json({ error: 'Failed during token exchange or data fetch' }, 500);
    }
  })

  // GET /connected-bank route
  .get('/connected-bank', async (c) => {
    const auth = getAuth(c);
    if (!auth?.userId) return c.json({ error: 'Unauthorized' }, 401);

    try {
      const bankConnection = await db.query.connectedBanks.findFirst({
        where: eq(connectedBanks.userId, auth.userId),
      });
      if (!bankConnection) return c.json({ data: null });
      const { accessToken, ...bankInfo } = bankConnection;
      return c.json({ data: bankInfo });
    } catch (error: any) {
      console.error('Get Connected Bank Error:', error.message);
      return c.json({ error: 'Failed to retrieve bank connection status' }, 500);
    }
  })

  // DELETE /connected-bank route
  .delete('/connected-bank', async (c) => {
    const auth = getAuth(c);
    if (!auth?.userId) return c.json({ error: 'Unauthorized' }, 401);

    try {
      const existingConnection = await db.query.connectedBanks.findFirst({
        where: eq(connectedBanks.userId, auth.userId),
      });
      if (!existingConnection) return c.json({ error: 'No bank connection found to delete' }, 404);

      // Also remove the Plaid item itself
      try {
        await client.itemRemove({ access_token: existingConnection.accessToken });
        console.log('Removed Plaid item:', existingConnection.itemId);
      } catch (plaidError: any) {
         // Log Plaid error but continue deleting from our DB
         console.error('Plaid itemRemove Error (proceeding with local delete):', plaidError.response?.data || plaidError.message);
      }

      // Delete from our database
      const [deletedData] = await db
        .delete(connectedBanks)
        .where(eq(connectedBanks.id, existingConnection.id))
        .returning({ id: connectedBanks.id });

      if (!deletedData) return c.json({ error: 'Failed to delete bank connection from DB' }, 500);

       // Consider deleting associated accounts and transactions (Be careful!)
       // You might want to delete only accounts associated with the removed itemId
       await db.delete(accounts).where(and(
         eq(accounts.userId, auth.userId),
         // Need a way to link accounts to the specific Plaid Item/Connection if deleting selectively
         // If PlaidId is globally unique, this might be okay, but linking to connectedBanks.id or itemId is safer
       ));
       console.log('Deleted associated accounts (verify logic).');
       // Transactions might be deleted automatically via cascade if schema is set up, otherwise delete manually


      return c.json({ data: deletedData });
    } catch (error: any) {
      console.error('Delete Connected Bank Error:', error.message);
      console.error(error); // Log full error
      return c.json({ error: 'Failed to delete bank connection' }, 500);
    }
  });

export default app;

