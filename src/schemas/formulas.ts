import { z } from 'zod';

export const formulaBindingSchema = z
    .object({
        __wwtype: z.string(),
        code: z.string(),
    })
    .catchall(z.unknown());

export type FormulaBinding = z.infer<typeof formulaBindingSchema>;

export function isFormulaBindingValue(value: unknown): value is FormulaBinding {
    return formulaBindingSchema.safeParse(value).success;
}
