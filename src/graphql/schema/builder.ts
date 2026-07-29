import SchemaBuilder from "@pothos/core";
import type { GraphQLSchema } from "graphql";
import type { Sql } from "@/lib/db";

export type GraphQLContext =
  | { getSql: () => Sql; sql?: Sql }
  | { getSql?: () => Sql; sql: Sql };

type BuilderConfig = {
  Context: GraphQLContext;
  DefaultFieldNullability: false;
  Scalars: {
    ID: { Input: string; Output: string | number };
    PositiveSafeInt: { Input: number; Output: number };
  };
};

function createBuilder() {
  const b = new SchemaBuilder<BuilderConfig>({
    defaultFieldNullability: false,
  });
  b.queryType({});
  return b;
}

export type AppBuilder = ReturnType<typeof createBuilder>;

/**
 * Survive Next.js / Turbopack HMR: re-evaluating modules must not create a
 * second SchemaBuilder or re-register typenames.
 */
const g = globalThis as unknown as {
  __silOflPothosBuilder?: AppBuilder;
  __silOflPothosTypesRegistered?: boolean;
  __silOflGraphqlSchema?: GraphQLSchema;
};

export const builder: AppBuilder =
  g.__silOflPothosBuilder ?? (g.__silOflPothosBuilder = createBuilder());

export function markTypesRegistered(): void {
  g.__silOflPothosTypesRegistered = true;
}

export function typesAlreadyRegistered(): boolean {
  return Boolean(g.__silOflPothosTypesRegistered);
}

export function getCachedSchema(): GraphQLSchema | undefined {
  return g.__silOflGraphqlSchema;
}

export function setCachedSchema(schema: GraphQLSchema): void {
  g.__silOflGraphqlSchema = schema;
}
