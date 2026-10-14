import { z } from "zod";
import { UNLIMITED } from "../../shared/limits";

export { UNLIMITED } from "../../shared/limits";
export const LimitSchema = z.union([z.literal(UNLIMITED), z.number().finite().nonnegative()]);
export const IntegerLimitSchema = LimitSchema.refine(Number.isInteger, { message: "Expected an integer limit" });
export const EnvironmentLimitSchema = z.string().trim().min(1).transform(Number).pipe(LimitSchema);
