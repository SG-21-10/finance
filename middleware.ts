import {
  clerkMiddleware,
  createRouteMatcher,
} from '@clerk/nextjs/server';

// Define which routes are public (don't require a sign-in)
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)', // The sign-in page
  '/sign-up(.*)', // The sign-up page
  // You can add other public pages here, e.g., a landing page
]);

export default clerkMiddleware((auth, req) => {
  // Protect all routes that are NOT public
  if (!isPublicRoute(req)) {
    auth().protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
