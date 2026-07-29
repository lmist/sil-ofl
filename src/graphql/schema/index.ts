import {
  builder,
  getCachedSchema,
  setCachedSchema,
} from "./builder";
import "./types";

const cached = getCachedSchema();
export const schema = cached ?? builder.toSchema();
if (!cached) {
  setCachedSchema(schema);
}

export { builder } from "./builder";
export type { GraphQLContext } from "./builder";
