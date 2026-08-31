import { z } from "zod";

const configSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  PUBLIC_ORIGIN: z.string().url(),
  MAX_CHANNELS: z.coerce.number().int().min(1).max(100_000).default(10_000),
  MAX_CONNECTIONS: z.coerce.number().int().min(2).max(200_000).default(20_000),
  MAX_MOBILES_PER_CHANNEL: z.coerce.number().int().min(1).max(50).default(10)
});

export type RelayConfig = z.infer<typeof configSchema>;
export const loadConfig = (): RelayConfig => configSchema.parse(process.env);
