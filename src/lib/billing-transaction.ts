// Model calls for one account serialize on its wallet row. Prisma's default
// five-second deadline includes that lock wait and can reject a funded batch.
// Keep both the connection wait and the complete transaction bounded.
export const BILLING_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 }
