import { z } from 'zod';
import { formulaBindingSchema } from './formulas.ts';

const schemaNameSchema = z.string().min(1).catch('public');
const tableFormulaColumnsConfigSchema = z.object({}).catchall(z.unknown());

export const tableFormulaColumnSchema = z
    .object({
        id: z.string().catch(''),
        schema: schemaNameSchema,
        tableName: z.string().min(1),
        name: z.string().min(1),
        formula: formulaBindingSchema.optional(),
        engineVersion: z.number().int().catch(1),
        transferErrorCode: z.string().nullable().optional(),
        compiledArtifact: z
            .object({
                graphHash: z.string(),
                sqlSchema: z.string(),
                sqlName: z.string(),
                previewVersion: z.literal(1).optional(),
                resultType: z.object({ formulaType: z.string(), postgresType: z.string() }),
                inputTypes: z.array(z.object({ name: z.string(), postgresType: z.string(), optional: z.boolean() })),
            })
            .nullable()
            .optional(),
    })
    .catchall(z.unknown())
    .superRefine((column, context) => {
        if (column.engineVersion === 2 || column.formula) return;
        context.addIssue({
            code: 'custom',
            path: ['formula'],
            message: 'Legacy formula columns require formula source.',
        });
    });

const tableFormulaColumnsInputSchema = z
    .union([z.array(z.unknown()), tableFormulaColumnsConfigSchema.transform(value => Object.values(value))])
    .catch([]);

export type TableFormulaColumn = z.infer<typeof tableFormulaColumnSchema>;

export const tableFormulaColumnsSchema = tableFormulaColumnsInputSchema.transform((columns): TableFormulaColumn[] => {
    const parsedColumns: TableFormulaColumn[] = [];

    for (const column of columns) {
        const parsedColumn = tableFormulaColumnSchema.safeParse(column);
        if (parsedColumn.success) parsedColumns.push(parsedColumn.data);
    }

    return parsedColumns;
});

export function parseSchema(schema: unknown) {
    return schemaNameSchema.parse(schema);
}

export function parseTableFormulaColumns(tableFormulaColumns: unknown): TableFormulaColumn[] {
    return tableFormulaColumnsSchema.parse(tableFormulaColumns);
}
