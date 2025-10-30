import { Hono } from 'hono';
import { getAuth } from '@hono/clerk-auth';
import { db } from '@/db/drizzle';
import { transactions, accounts, categories } from '@/db/schema';
import { and, desc, eq, gte, lte, sql, sum } from 'drizzle-orm';
import { subDays, format } from 'date-fns';

const app = new Hono()
  .get('/', async (c) => {
    const auth = getAuth(c);

    if (!auth?.userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const thirtyDaysAgo = subDays(new Date(), 30);
    const today = new Date();

    try {
      // Fetch expenses (negative amounts) in the last 30 days, grouped by payee
      const spendingByPayee = await db // Renamed for clarity
        .select({
          payee: transactions.payee,
          total: sql<number>`sum(ABS(${transactions.amount}))`.mapWith(Number), // Sum absolute values of amounts
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .where(
          and(
            eq(accounts.userId, auth.userId),
            gte(transactions.date, thirtyDaysAgo),
            lte(transactions.date, today),
            lte(transactions.amount, 0) // Only consider expenses (amount <= 0)
          )
        )
        .groupBy(transactions.payee)
        .orderBy(desc(sql<number>`sum(ABS(${transactions.amount}))`))
        .limit(5); // Get top 5 spending payees

      // --- Basic Recommendation Logic ---
      const recommendations: string[] = [];

      if (spendingByPayee.length === 0) {
        recommendations.push("Keep up the great work! No significant spending patterns detected in the last 30 days.");
      } else {
         recommendations.push("Here are some areas where you spent the most in the last 30 days:");

         spendingByPayee.forEach(item => {
             // Convert amount from milliunits back to currency string - MODIFIED FOR INR
             const formattedAmount = new Intl.NumberFormat('en-IN', { // <-- Changed locale to en-IN
               style: 'currency',
               currency: 'INR', // <-- Changed currency to INR
             }).format(item.total / 1000); // Amount is stored in milliunits, convert back

             recommendations.push(`Consider reviewing your spending with "${item.payee || 'Uncategorized'}" (Total: ${formattedAmount}).`); // Added fallback for null payee

             // Add more specific suggestions based on common payee names if desired
             if (item.payee?.toLowerCase().includes('coffee') || item.payee?.toLowerCase().includes('starbucks')) {
                 recommendations.push(`Making coffee/tea at home could save money.`);
             }
             if (item.payee?.toLowerCase().includes('amazon') || item.payee?.toLowerCase().includes('flipkart')) { // Added Flipkart
                 recommendations.push(`Check if your recent online purchases were essential.`);
             }
             if (item.payee?.toLowerCase().includes('uber') || item.payee?.toLowerCase().includes('ola') || item.payee?.toLowerCase().includes('rapido')) { // Added Ola/Rapido
                 recommendations.push(`Could you use public transport, walk, or cycle more often?`);
             }
             if (item.payee?.toLowerCase().includes('zomato') || item.payee?.toLowerCase().includes('swiggy')) { // Added Swiggy/Zomato
                recommendations.push(`Ordering food frequently? Cooking at home can lead to significant savings.`);
             }
         });

         if (spendingByPayee.length >= 3) { // Changed condition slightly
            recommendations.push("Reviewing these top spending areas might help you save!");
         }
      }


      // Remove duplicate recommendations
      const uniqueRecommendations = [...new Set(recommendations)];

      return c.json({ data: uniqueRecommendations });

    } catch (error: any) {
      console.error("Error fetching recommendations:", error);
      return c.json({ error: 'Failed to generate recommendations' }, 500);
    }
  });

export default app;

