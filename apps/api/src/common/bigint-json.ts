// Prisma returns BIGINT columns (Customer.telegramId) as BigInt, which
// JSON.stringify rejects outright — any response or event that includes a
// customer row would otherwise fail with a 500.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};
