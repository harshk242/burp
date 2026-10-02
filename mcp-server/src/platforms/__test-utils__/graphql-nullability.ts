/**
 * GraphQL nullability for schema contract tests.
 *
 * Sampled snapshots cannot tell a nullable field apart from one that happened
 * to be populated at capture time. For GraphQL APIs the schema states this
 * explicitly, so we derive the set of response paths that may legitimately be
 * `null` and let the schema validator tolerate null drift on exactly those.
 *
 * Paths use the schema-validator format: `$.search.hits[].description`.
 */

import axios from 'axios';
import {
  buildClientSchema,
  getIntrospectionQuery,
  getNamedType,
  getNullableType,
  isCompositeType,
  isListType,
  isNonNullType,
  isObjectType,
  isInterfaceType,
  Kind,
  parse,
  validate,
  type FragmentDefinitionNode,
  type GraphQLCompositeType,
  type GraphQLOutputType,
  type GraphQLSchema,
  type IntrospectionQuery,
  type SelectionSetNode,
} from 'graphql';

/** Fetch and build a client schema from a live GraphQL endpoint. */
export async function fetchGraphQLSchema(url: string): Promise<GraphQLSchema> {
  const res = await axios.post(
    url,
    { query: getIntrospectionQuery() },
    { headers: { 'Content-Type': 'application/json' }, timeout: 20_000 },
  );
  if (res.data.errors?.length) {
    throw new Error(`Introspection failed: ${JSON.stringify(res.data.errors)}`);
  }
  return buildClientSchema(res.data.data as IntrospectionQuery);
}

/**
 * Return every response path in `operation` whose value the schema allows to
 * be null. Fields selected through several inline fragments (e.g. `id` under
 * `... on Target` and `... on Disease`) share one path, matching the
 * validator's flattened schema; GraphQL validation guarantees such fields
 * agree on nullability.
 *
 * Throws if the operation does not validate against the schema.
 */
export function collectNullablePaths(schema: GraphQLSchema, operation: string): Set<string> {
  const document = parse(operation);
  const errors = validate(schema, document);
  if (errors.length > 0) {
    throw new Error(`Operation is invalid against schema: ${errors.map((e) => e.message).join('; ')}`);
  }

  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    }
  }

  const nullable = new Set<string>();
  const ctx = { schema, fragments, nullable };

  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
    const rootType = schema.getRootType(definition.operation);
    if (!rootType) throw new Error(`Schema has no ${definition.operation} root type`);
    walkSelectionSet(ctx, definition.selectionSet, rootType, '$');
  }

  return nullable;
}

interface WalkContext {
  schema: GraphQLSchema;
  fragments: Map<string, FragmentDefinitionNode>;
  nullable: Set<string>;
}

function walkSelectionSet(
  ctx: WalkContext,
  selectionSet: SelectionSetNode,
  parentType: GraphQLCompositeType,
  path: string,
): void {
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const fieldName = selection.name.value;
      // __typename is always a non-null String
      if (fieldName === '__typename') continue;
      if (!isObjectType(parentType) && !isInterfaceType(parentType)) continue;

      const field = parentType.getFields()[fieldName];
      const key = selection.alias?.value ?? fieldName;
      walkType(ctx, field.type, selection.selectionSet, `${path}.${key}`);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      const typeName = selection.typeCondition?.name.value;
      const fragmentType = typeName ? ctx.schema.getType(typeName) : parentType;
      if (isCompositeType(fragmentType)) {
        walkSelectionSet(ctx, selection.selectionSet, fragmentType, path);
      }
    } else {
      const fragment = ctx.fragments.get(selection.name.value);
      const fragmentType = fragment && ctx.schema.getType(fragment.typeCondition.name.value);
      if (fragment && isCompositeType(fragmentType)) {
        walkSelectionSet(ctx, fragment.selectionSet, fragmentType, path);
      }
    }
  }
}

function walkType(
  ctx: WalkContext,
  type: GraphQLOutputType,
  selectionSet: SelectionSetNode | undefined,
  path: string,
): void {
  if (!isNonNullType(type)) ctx.nullable.add(path);

  const unwrapped = getNullableType(type);
  if (isListType(unwrapped)) {
    walkType(ctx, unwrapped.ofType as GraphQLOutputType, selectionSet, `${path}[]`);
    return;
  }

  const named = getNamedType(unwrapped);
  if (selectionSet && isCompositeType(named)) {
    walkSelectionSet(ctx, selectionSet, named, path);
  }
}
