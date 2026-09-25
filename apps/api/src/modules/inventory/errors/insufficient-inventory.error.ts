/**
 * Thrown by the reservation primitives when there isn't enough stock to
 * satisfy a request. Deliberately not a NestJS HTTP exception — this error
 * crosses a transaction boundary inside OrdersService (Phase 5), which
 * decides how to translate it into a customer-facing response.
 */
export class InsufficientInventoryError extends Error {
  constructor(
    public readonly productId: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(
      `Insufficient inventory for product ${productId}: requested ${requested}, available ${available}`,
    );
    this.name = 'InsufficientInventoryError';
  }
}
