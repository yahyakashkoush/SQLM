import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const moneySchema = z.object({
  amount: z.number().nonnegative(),
  currency: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/),
});
export type Money = z.infer<typeof moneySchema>;
