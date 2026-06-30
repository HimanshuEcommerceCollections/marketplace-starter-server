import { ApiError } from "../../../utils/api-error";
import type { PaymentProvider } from "./payment-provider.interface";
import { stripeProvider } from "./stripe.provider";

/**
 * Provider registry. Add new adapters (Razorpay, PayPal, …) to this map; the
 * payment service resolves them by name and is otherwise provider-agnostic.
 */
const providers: Record<string, PaymentProvider> = {
  [stripeProvider.name]: stripeProvider,
};

const DEFAULT_PROVIDER = stripeProvider.name;

export function resolveProvider(name: string = DEFAULT_PROVIDER): PaymentProvider {
  const provider = providers[name.toLowerCase()];
  if (!provider) {
    throw ApiError.notFound(`Unknown payment provider: ${name}`);
  }
  return provider;
}

export type { PaymentProvider } from "./payment-provider.interface";
