import type { z } from "zod";
import type { joinWaitlistSchema, listWaitlistSchema } from "./waitlist.validation";

export type JoinWaitlistDto = z.infer<typeof joinWaitlistSchema>;
export type ListWaitlistQuery = z.infer<typeof listWaitlistSchema>;
