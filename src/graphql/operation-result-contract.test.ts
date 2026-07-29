import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  Kind,
  isEnumType,
  isInputType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  parse,
  type GraphQLInputType,
  type GraphQLObjectType,
  type GraphQLOutputType,
  type SelectionSetNode,
  type TypeNode,
} from "graphql";
import ts from "typescript";
import {
  FONT_QUERY,
  FONTS_QUERY,
  HEALTH_QUERY,
  REPO_QUERY,
  REPOS_QUERY,
  STATS_QUERY,
} from "@/graphql/documents";
import { schema } from "@/graphql/schema";

type Contract =
  | { kind: "list"; item: Contract }
  | { kind: "literal"; value: string }
  | { kind: "null" }
  | { kind: "object"; fields: Record<string, Contract> }
  | { kind: "scalar"; type: "boolean" | "number" | "string" }
  | { kind: "undefined" }
  | { kind: "union"; members: Contract[] };

const operationTypes = [
  {
    document: HEALTH_QUERY,
    resultType: "HealthQueryResult",
    variablesType: null,
  },
  {
    document: STATS_QUERY,
    resultType: "StatsQueryResult",
    variablesType: null,
  },
  {
    document: FONTS_QUERY,
    resultType: "FontsQueryResult",
    variablesType: "FontsQueryVariables",
  },
  {
    document: FONT_QUERY,
    resultType: "FontQueryResult",
    variablesType: "FontQueryVariables",
  },
  {
    document: REPOS_QUERY,
    resultType: "ReposQueryResult",
    variablesType: "ReposQueryVariables",
  },
  {
    document: REPO_QUERY,
    resultType: "RepoQueryResult",
    variablesType: "RepoQueryVariables",
  },
] as const;

const documentsSource = ts.createSourceFile(
  "documents.ts",
  readFileSync(resolve(process.cwd(), "src/graphql/documents.ts"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const typeAliases = new Map(
  documentsSource.statements
    .filter(ts.isTypeAliasDeclaration)
    .map((declaration) => [declaration.name.text, declaration.type]),
);

describe("GraphQL operation result types", () => {
  for (const { document, resultType } of operationTypes) {
    it(`keeps ${resultType} aligned with its executable operation`, () => {
      assert.deepEqual(
        typeScriptResultContract(resultType),
        graphQLResultContract(document),
      );
    });
  }
});

describe("GraphQL operation variable types", () => {
  for (const { document, resultType, variablesType } of operationTypes) {
    it(`keeps ${variablesType ?? `${resultType} variables`} aligned with its executable operation`, () => {
      const expected = graphQLVariablesContract(document);
      if (variablesType === null) {
        assert.deepEqual(expected, objectContract({}));
        return;
      }
      assert.deepEqual(
        typeScriptVariablesContract(variablesType),
        expected,
      );
    });
  }
});

function graphQLResultContract(document: string): Contract {
  const operation = parse(document).definitions.find(
    (definition) => definition.kind === Kind.OPERATION_DEFINITION,
  );
  assert.ok(operation, "operation document must contain an operation");
  assert.equal(operation.operation, "query");

  const query = schema.getQueryType();
  assert.ok(query, "schema must define a query type");
  return selectionContract(query, operation.selectionSet);
}

function selectionContract(
  parent: GraphQLObjectType,
  selectionSet: SelectionSetNode,
): Contract {
  const fields: Record<string, Contract> = {};

  for (const selection of selectionSet.selections) {
    assert.equal(
      selection.kind,
      Kind.FIELD,
      "shipped operations must expand fragments before contract comparison",
    );
    const fieldName = selection.name.value;
    const responseName = selection.alias?.value ?? fieldName;
    const field = parent.getFields()[fieldName];
    assert.ok(field, `${parent.name}.${fieldName} must exist`);
    assert.equal(
      fields[responseName],
      undefined,
      `${responseName} must only be selected once`,
    );
    fields[responseName] = outputContract(field.type, selection.selectionSet);
  }

  return objectContract(fields);
}

function outputContract(
  type: GraphQLOutputType,
  selectionSet: SelectionSetNode | undefined,
): Contract {
  if (isNonNullType(type)) {
    return nonNullOutputContract(type.ofType, selectionSet);
  }
  return unionContract([
    { kind: "null" },
    nonNullOutputContract(type, selectionSet),
  ]);
}

function nonNullOutputContract(
  type: GraphQLOutputType,
  selectionSet: SelectionSetNode | undefined,
): Contract {
  if (isNonNullType(type)) {
    return nonNullOutputContract(type.ofType, selectionSet);
  }
  if (isListType(type)) {
    return { kind: "list", item: outputContract(type.ofType, selectionSet) };
  }
  if (isObjectType(type)) {
    assert.ok(selectionSet, `${type.name} must have a selection set`);
    return selectionContract(type, selectionSet);
  }
  if (isScalarType(type)) {
    assert.equal(selectionSet, undefined, `${type.name} cannot have selections`);
    return scalarContract(type.name);
  }
  throw new Error(`Unsupported GraphQL output type: ${type}`);
}

function scalarContract(name: string): Contract {
  if (name === "Boolean") return { kind: "scalar", type: "boolean" };
  if (name === "ID" || name === "String") {
    return { kind: "scalar", type: "string" };
  }
  if (name === "Float" || name === "Int" || name === "PositiveSafeInt") {
    return { kind: "scalar", type: "number" };
  }
  throw new Error(`GraphQL scalar ${name} needs an explicit client mapping`);
}

function graphQLVariablesContract(document: string): Contract {
  const operation = parse(document).definitions.find(
    (definition) => definition.kind === Kind.OPERATION_DEFINITION,
  );
  assert.ok(operation, "operation document must contain an operation");

  return objectContract(
    Object.fromEntries(
      (operation.variableDefinitions ?? []).map((definition) => {
        let contract = graphQLTypeNodeContract(definition.type);
        if (
          definition.type.kind !== Kind.NON_NULL_TYPE ||
          definition.defaultValue !== undefined
        ) {
          contract = unionContract([{ kind: "undefined" }, contract]);
        }
        return [definition.variable.name.value, contract];
      }),
    ),
  );
}

function graphQLTypeNodeContract(node: TypeNode): Contract {
  if (node.kind === Kind.NON_NULL_TYPE) {
    return graphQLNonNullTypeNodeContract(node.type);
  }
  return unionContract([
    { kind: "null" },
    graphQLNonNullTypeNodeContract(node),
  ]);
}

function graphQLNonNullTypeNodeContract(
  node: Exclude<TypeNode, { kind: typeof Kind.NON_NULL_TYPE }>,
): Contract {
  if (node.kind === Kind.LIST_TYPE) {
    return { kind: "list", item: graphQLTypeNodeContract(node.type) };
  }

  const type = schema.getType(node.name.value);
  assert.ok(
    type && isInputType(type),
    `GraphQL input type ${node.name.value} must exist`,
  );
  return graphQLNamedInputContract(type);
}

function graphQLInputContract(type: GraphQLInputType): Contract {
  if (isNonNullType(type)) {
    return graphQLNonNullInputContract(type.ofType);
  }
  return unionContract([
    { kind: "null" },
    graphQLNonNullInputContract(type),
  ]);
}

function graphQLNonNullInputContract(type: GraphQLInputType): Contract {
  if (isNonNullType(type)) {
    return graphQLNonNullInputContract(type.ofType);
  }
  if (isListType(type)) {
    return { kind: "list", item: graphQLInputContract(type.ofType) };
  }
  return graphQLNamedInputContract(type);
}

function graphQLNamedInputContract(
  type: GraphQLInputType,
): Contract {
  if (isNonNullType(type)) {
    return graphQLNamedInputContract(type.ofType);
  }
  if (isListType(type)) {
    return { kind: "list", item: graphQLInputContract(type.ofType) };
  }
  if (isScalarType(type)) return scalarContract(type.name);
  if (isEnumType(type)) {
    return unionContract(
      type
        .getValues()
        .map(({ name }) => ({ kind: "literal", value: name }) as const),
    );
  }
  if (isInputObjectType(type)) {
    return objectContract(
      Object.fromEntries(
        Object.entries(type.getFields()).map(([name, field]) => {
          let contract = graphQLInputContract(field.type);
          if (!isNonNullType(field.type) || field.defaultValue !== undefined) {
            contract = unionContract([{ kind: "undefined" }, contract]);
          }
          return [name, contract];
        }),
      ),
    );
  }
  throw new Error(`Unsupported GraphQL input type: ${type}`);
}

function typeScriptResultContract(name: string): Contract {
  const type = typeAliases.get(name);
  assert.ok(type, `documents.ts must export type ${name}`);
  return typeScriptTypeContract(type, new Set([name]), false);
}

function typeScriptVariablesContract(name: string): Contract {
  const type = typeAliases.get(name);
  assert.ok(type, `documents.ts must export type ${name}`);
  return typeScriptTypeContract(type, new Set([name]), true);
}

function typeScriptTypeContract(
  node: ts.TypeNode,
  resolving: Set<string>,
  allowOptionalProperties: boolean,
): Contract {
  if (node.kind === ts.SyntaxKind.StringKeyword) {
    return { kind: "scalar", type: "string" };
  }
  if (node.kind === ts.SyntaxKind.NumberKeyword) {
    return { kind: "scalar", type: "number" };
  }
  if (node.kind === ts.SyntaxKind.BooleanKeyword) {
    return { kind: "scalar", type: "boolean" };
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return typeScriptTypeContract(
      node.type,
      resolving,
      allowOptionalProperties,
    );
  }
  if (ts.isLiteralTypeNode(node)) {
    if (node.literal.kind === ts.SyntaxKind.NullKeyword) {
      return { kind: "null" };
    }
    if (ts.isStringLiteral(node.literal)) {
      return { kind: "literal", value: node.literal.text };
    }
  }
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) {
    return { kind: "undefined" };
  }
  if (ts.isUnionTypeNode(node)) {
    return unionContract(
      node.types.map((member) =>
        typeScriptTypeContract(
          member,
          resolving,
          allowOptionalProperties,
        ),
      ),
    );
  }
  if (ts.isArrayTypeNode(node)) {
    return {
      kind: "list",
      item: typeScriptTypeContract(
        node.elementType,
        resolving,
        allowOptionalProperties,
      ),
    };
  }
  if (ts.isTypeLiteralNode(node)) {
    const fields: Record<string, Contract> = {};
    for (const member of node.members) {
      assert.ok(
        ts.isPropertySignature(member) && member.type,
        "operation types may only contain typed properties",
      );
      if (!allowOptionalProperties) {
        assert.equal(
          member.questionToken,
          undefined,
          "selected GraphQL result properties cannot be optional",
        );
      }
      let contract = typeScriptTypeContract(
        member.type,
        resolving,
        allowOptionalProperties,
      );
      if (member.questionToken) {
        contract = unionContract([{ kind: "undefined" }, contract]);
      }
      fields[propertyName(member.name)] = contract;
    }
    return objectContract(fields);
  }
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text;
    if (name === "Array" || name === "ReadonlyArray") {
      assert.equal(node.typeArguments?.length, 1);
      return {
        kind: "list",
        item: typeScriptTypeContract(
          node.typeArguments[0]!,
          resolving,
          allowOptionalProperties,
        ),
      };
    }

    const referenced = typeAliases.get(name);
    assert.ok(referenced, `documents.ts type ${name} must be locally declared`);
    assert.ok(!resolving.has(name), `recursive result type ${name} is unsupported`);
    const nextResolving = new Set(resolving);
    nextResolving.add(name);
    return typeScriptTypeContract(
      referenced,
      nextResolving,
      allowOptionalProperties,
    );
  }

  throw new Error(
    `Unsupported TypeScript result syntax: ${node.getText(documentsSource)}`,
  );
}

function propertyName(name: ts.PropertyName): string {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  throw new Error(`Unsupported result property name: ${name.getText()}`);
}

function objectContract(fields: Record<string, Contract>): Contract {
  return {
    kind: "object",
    fields: Object.fromEntries(
      Object.entries(fields).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}

function unionContract(members: Contract[]): Contract {
  const unique = new Map<string, Contract>();
  for (const member of members.flatMap((candidate) =>
    candidate.kind === "union" ? candidate.members : [candidate],
  )) {
    unique.set(JSON.stringify(member), member);
  }
  const normalized = [...unique.values()].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
  return normalized.length === 1
    ? normalized[0]!
    : { kind: "union", members: normalized };
}
