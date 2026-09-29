import { z } from 'zod';

export const cartItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(50),
});
export type CartItem = z.infer<typeof cartItemSchema>;

export const checkoutRequestSchema = z.object({
  items: z.array(cartItemSchema).min(1).max(20),
  paymentMethodId: z.string().uuid(),
  /**
   * Client-generated idempotency key (e.g. a UUID persisted in the Mini
   * App's local storage for the lifetime of the cart). Retried checkout
   * requests with the same key return the original order instead of
   * creating a duplicate.
   */
  idempotencyKey: z.string().min(8).max(128),
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const paymentProofUploadSchema = z.object({
  orderId: z.string().uuid(),
});
export type PaymentProofUpload = z.infer<typeof paymentProofUploadSchema>;
