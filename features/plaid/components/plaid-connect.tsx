import { useState, useEffect } from 'react';
import { useMount } from 'react-use';
import { usePlaidLink } from 'react-plaid-link';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query'; // Import queryClient hook

import { useCreateLinkToken } from '@/features/plaid/api/use-create-link-token';
import { useExchangePublicToken } from '@/features/plaid/api/use-exchange-public-token';

import { Button } from '@/components/ui/button';

export const PlaidConnect = () => {
  const [token, setToken] = useState<string | null>(null);
  const queryClient = useQueryClient(); // Get query client instance

  // Note: We temporarily removed the usePaywall hook to simplify debugging Plaid.
  // You might want to re-add it later.
  // const { shouldBlock, triggerPaywall, isLoading: isLoadingPaywall } = usePaywall();

  const createLinkToken = useCreateLinkToken();
  const exchangePublicToken = useExchangePublicToken();

  const fetchToken = () => {
    console.log('Attempting to fetch link token...');
    createLinkToken.mutate(undefined, {
      onSuccess: ({ data }) => {
        if (data && typeof data.link_token === 'string') {
          setToken(data.link_token);
          console.log('Successfully received link token:', data.link_token);
        } else {
          console.error('Received invalid link token format:', data);
          toast.error('Received invalid link token format.');
          setToken(null); // Ensure token is null if invalid
        }
      },
      onError: (error) => {
        console.error('Failed to create link token mutation:', error);
        toast.error('Failed to fetch Plaid connection token.');
        setToken(null);
      }
    });
  };

  // Fetch token on component mount
  useMount(fetchToken);

  const { open, ready, error } = usePlaidLink({
    token: token,
    onSuccess: (publicToken) => {
      console.log('Plaid Link onSuccess:', publicToken);
      exchangePublicToken.mutate({ publicToken }, {
        // --- ADDED: Refetch data on successful token exchange ---
        onSuccess: () => {
          toast.success('Bank account connected successfully!');
          // Invalidate queries to trigger data refetch for dashboard/settings
          queryClient.invalidateQueries({ queryKey: ['connectedBank'] });
          queryClient.invalidateQueries({ queryKey: ['accounts'] });
          queryClient.invalidateQueries({ queryKey: ['summary'] });
          // Add other relevant query keys if needed (e.g., transactions)
          // queryClient.invalidateQueries({ queryKey: ['transactions'] });
        },
        onError: (error) => {
           console.error('Failed to exchange public token mutation:', error);
           toast.error('Failed to finalize bank connection.');
        }
        // --- End Added ---
      });
    },
    onExit: (err, metadata) => {
      console.log('Plaid Link onExit:', err, metadata);
    },
    onEvent: (eventName, metadata) => {
      console.log('Plaid Link onEvent:', eventName, metadata);
    },
  });

  useEffect(() => {
    if (error) {
      console.error('usePlaidLink Error:', error);
      toast.error(`Plaid Link error: ${error.message}`);
    }
  }, [error]);

  const onClick = () => {
    console.log('Connect Clicked. Current Token:', token, 'Plaid Ready:', ready);

    if (token === null) {
      console.log('Token is null, attempting fetch on click.');
      fetchToken(); // Re-fetch if token is missing
      toast.info('Initializing connection, please click connect again.');
      return;
    }

    // Call open directly, let usePlaidLink handle readiness internally
    if (typeof open === 'function') {
      console.log('Is \'open\' function available? true');
      try {
        console.log('Attempting to open Plaid Link...');
        open();
        console.log('Called open() successfully.');
      } catch (e) {
        console.error('Error calling open():', e);
        toast.error('Could not open Plaid connection window.');
      }
    } else {
      console.error('Is \'open\' function available? false');
      toast.error('Plaid connection handler not available.');
    }
  };

  // Disable button while fetching initial token or exchanging public token
  const isDisabled = createLinkToken.isPending || exchangePublicToken.isPending;

  return (
    <Button onClick={onClick} disabled={isDisabled} size="sm" variant="ghost">
      {createLinkToken.isPending ? 'Initializing...' : 'Connect'}
    </Button>
  );
};

