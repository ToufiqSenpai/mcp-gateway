import type { ESTree } from "@oxlint/plugins";

const BUILT_INS = new Set([
	"Record",
	"Readonly",
	"Partial",
	"Required",
	"Pick",
	"Omit",
	"PropertyKey",
	"NonNullable",
]);
const TRANSPARENT_WRAPPERS = new Set(["Readonly", "Partial", "Required", "NonNullable"]);

type TypeAliasEnvironment = ReadonlyMap<string, ESTree.TSType>;

type ResolvedType = {
	readonly type: ESTree.TSType;
	readonly substitutions: TypeAliasEnvironment;
};

export type UnsafeDictionary = {
	readonly kind: "unsafe-dictionary";
	readonly unsafeValue: "any" | "empty-object" | "object" | "union" | "unknown";
};

export type WideningTargetKind =
	| "anonymous object"
	| "generic container"
	| "object"
	| "open dictionary"
	| "unknown";

export type WideningTarget = {
	readonly kind: WideningTargetKind;
};

export type TypeEnvironment = {
	readonly aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>;
	readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
	readonly shadowedBuiltIns: ReadonlySet<string>;
};

function declaredStatement(statement: ESTree.Statement): ESTree.Node | null {
	return statement.type === "ExportNamedDeclaration" ||
		statement.type === "ExportDefaultDeclaration"
		? (statement.declaration ?? null)
		: statement;
}

type EnvironmentMaps = {
	aliases: Map<string, ESTree.TSTypeAliasDeclaration>;
	interfaces: Map<string, ESTree.TSInterfaceDeclaration[]>;
	shadowedBuiltIns: Set<string>;
};

function collectDeclaration(declaration: ESTree.Node | null, environment: EnvironmentMaps): void {
	if (declaration?.type === "ImportDeclaration") {
		for (const specifier of declaration.specifiers) {
			if (BUILT_INS.has(specifier.local.name)) environment.shadowedBuiltIns.add(specifier.local.name);
		}
		return;
	}

	if (declaration?.type === "TSTypeAliasDeclaration") {
		const existing = environment.aliases.get(declaration.id.name);
		if (existing === undefined) environment.aliases.set(declaration.id.name, declaration);
		else environment.shadowedBuiltIns.add(declaration.id.name);
		if (BUILT_INS.has(declaration.id.name)) environment.shadowedBuiltIns.add(declaration.id.name);
		return;
	}

	if (declaration?.type === "TSInterfaceDeclaration") {
		const declarations = environment.interfaces.get(declaration.id.name) ?? [];
		declarations.push(declaration);
		environment.interfaces.set(declaration.id.name, declarations);
		if (BUILT_INS.has(declaration.id.name)) environment.shadowedBuiltIns.add(declaration.id.name);
		return;
	}

	if (declaration?.type === "TSEnumDeclaration") {
		if (BUILT_INS.has(declaration.id.name)) environment.shadowedBuiltIns.add(declaration.id.name);
		return;
	}

	if (
		(declaration?.type === "ClassDeclaration" || declaration?.type === "FunctionDeclaration") &&
		declaration.id !== null
	) {
		if (BUILT_INS.has(declaration.id.name)) environment.shadowedBuiltIns.add(declaration.id.name);
	}
}

export function createTypeEnvironment(program: ESTree.Program): TypeEnvironment {
	const environment: EnvironmentMaps = {
		aliases: new Map(),
		interfaces: new Map(),
		shadowedBuiltIns: new Set(),
	};

	for (const statement of program.body) {
		collectDeclaration(declaredStatement(statement), environment);
	}

	return environment;
}

function typeReferenceName(type: ESTree.TSTypeReference): string | null {
	return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function isBuiltIn(name: string, environment: TypeEnvironment): boolean {
	return BUILT_INS.has(name) && !environment.shadowedBuiltIns.has(name);
}

function isUnappliedReferenceTo(type: ESTree.TSType, name: string): boolean {
	const unwrapped = unwrapTransparentType(type);
	return (
		unwrapped.type === "TSTypeReference" &&
		typeReferenceName(unwrapped) === name &&
		(unwrapped.typeArguments === null ||
			unwrapped.typeArguments === undefined ||
			unwrapped.typeArguments.params.length === 0)
	);
}

function unwrapTransparentType(type: ESTree.TSType): ESTree.TSType {
	let current = type;
	while (
		current.type === "TSParenthesizedType" ||
		(current.type === "TSTypeOperator" && current.operator === "readonly")
	) {
		current = current.typeAnnotation;
	}
	return current;
}

function isNeverType(type: ESTree.TSType): boolean {
	return unwrapTransparentType(type).type === "TSNeverKeyword";
}

function isEffectivelyEmptyMember(member: ESTree.TSSignature): boolean {
	return (
		member.type === "TSPropertySignature" &&
		member.optional === true &&
		member.typeAnnotation !== null &&
		member.typeAnnotation !== undefined &&
		isNeverType(member.typeAnnotation.typeAnnotation)
	);
}

function isEffectivelyEmptyTypeLiteral(type: ESTree.TSTypeLiteral): boolean {
	return type.members.every(isEffectivelyEmptyMember);
}

function isEffectivelyEmptyInterface(
	declarations: readonly ESTree.TSInterfaceDeclaration[],
): boolean {
	if (declarations.length !== 1) return false;
	const [type] = declarations;
	return (
		type !== undefined &&
		type.extends.length === 0 &&
		type.body.body.every(isEffectivelyEmptyMember)
	);
}

function resolvedSubstitutionArgument(
	type: ESTree.TSType,
	base: TypeAliasEnvironment,
	resolving: ReadonlySet<string> = new Set(),
): ESTree.TSType {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.type !== "TSTypeReference") return type;
	const name = typeReferenceName(unwrapped);
	if (name === null || resolving.has(name)) return type;
	const substitution = base.get(name);
	if (substitution === undefined) return type;
	const nextResolving = new Set(resolving);
	nextResolving.add(name);
	return resolvedSubstitutionArgument(substitution, base, nextResolving);
}

function aliasSubstitution(
	alias: ESTree.TSTypeAliasDeclaration,
	type: ESTree.TSTypeReference,
	base: TypeAliasEnvironment,
): TypeAliasEnvironment | null {
	const parameters = alias.typeParameters?.params ?? [];
	const arguments_ = type.typeArguments?.params ?? [];
	const next = new Map(base);
	for (const [index, parameter] of parameters.entries()) {
		const argument = arguments_[index] ?? parameter.default;
		if (argument === null || argument === undefined) return null;
		next.set(parameter.name.name, resolvedSubstitutionArgument(argument, next));
	}
	return next;
}

type UnsafeValue = UnsafeDictionary["unsafeValue"];

function unsafeKeywordValue(type: ESTree.TSType): UnsafeValue | null {
	if (type.type === "TSUnknownKeyword") return "unknown";
	if (type.type === "TSAnyKeyword") return "any";
	if (type.type === "TSObjectKeyword") return "object";
	if (type.type === "TSTypeLiteral" && isEffectivelyEmptyTypeLiteral(type)) return "empty-object";
	return null;
}

function unsafeIntersectionValue(
	types: readonly ESTree.TSType[],
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): UnsafeValue | null {
	const unsafeMembers = types.map((member) =>
		unsafeDirectValue(member, environment, substitutions, resolvingAliases),
	);
	if (unsafeMembers.includes("any")) return "any";
	return unsafeMembers.length > 0 && unsafeMembers.every((member) => member !== null)
		? unsafeMembers[0]
		: null;
}

function unsafeReferenceValue(
	type: ESTree.TSTypeReference,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): UnsafeValue | null {
	const name = typeReferenceName(type);
	if (name === null) return null;
	if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
		const wrapped = type.typeArguments?.params[0];
		return wrapped === undefined
			? null
			: unsafeDirectValue(wrapped, environment, substitutions, resolvingAliases);
	}
	const substitution = substitutions.get(name);
	if (substitution !== undefined) {
		return isUnappliedReferenceTo(substitution, name)
			? null
			: unsafeDirectValue(substitution, environment, substitutions, resolvingAliases);
	}
	const interfaceDeclarations = environment.interfaces.get(name);
	if (interfaceDeclarations !== undefined) {
		return isEffectivelyEmptyInterface(interfaceDeclarations) ? "empty-object" : null;
	}
	const alias = environment.aliases.get(name);
	if (alias === undefined || resolvingAliases.has(name)) return null;
	const nextSubstitutions = aliasSubstitution(alias, type, substitutions);
	if (nextSubstitutions === null) return null;
	const nextResolving = new Set(resolvingAliases);
	nextResolving.add(name);
	return unsafeDirectValue(alias.typeAnnotation, environment, nextSubstitutions, nextResolving);
}

function unsafeDirectValue(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): UnsafeValue | null {
	const unwrapped = unwrapTransparentType(type);
	const keyword = unsafeKeywordValue(unwrapped);
	if (keyword !== null) return keyword;
	if (unwrapped.type === "TSUnionType") {
		return unwrapped.types.some(
			(member) => unsafeDirectValue(member, environment, substitutions, resolvingAliases) !== null,
		)
			? "union"
			: null;
	}
	if (unwrapped.type === "TSIntersectionType") {
		return unsafeIntersectionValue(unwrapped.types, environment, substitutions, resolvingAliases);
	}
	if (unwrapped.type !== "TSTypeReference") return null;
	return unsafeReferenceValue(unwrapped, environment, substitutions, resolvingAliases);
}

function literalValueTypes(
	type: ESTree.TSTypeLiteral,
	substitutions: TypeAliasEnvironment,
): readonly ResolvedType[] {
	return type.members.flatMap((member): readonly ResolvedType[] =>
		member.type === "TSIndexSignature" && member.typeAnnotation !== null
			? [{ type: member.typeAnnotation.typeAnnotation, substitutions }]
			: [],
	);
}

function mappedValueTypes(
	type: ESTree.TSMappedType,
	substitutions: TypeAliasEnvironment,
): readonly ResolvedType[] {
	return type.typeAnnotation === null ? [] : [{ type: type.typeAnnotation, substitutions }];
}

/** `Readonly`/`Partial`/`Required`/`NonNullable` keep the values of their only argument. */
function transparentValueTypes(
	name: string,
	type: ESTree.TSTypeReference,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): readonly ResolvedType[] | undefined {
	if (!TRANSPARENT_WRAPPERS.has(name) || !isBuiltIn(name, environment)) return undefined;
	const wrapped = type.typeArguments?.params[0];
	return wrapped === undefined
		? []
		: dictionaryValueTypes(wrapped, environment, substitutions, resolvingAliases);
}

/** `Record` and `Pick`/`Omit` expose the dictionary values of their arguments. */
function builtInValueTypes(
	name: string,
	type: ESTree.TSTypeReference,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): readonly ResolvedType[] | undefined {
	if (name === "Record" && isBuiltIn(name, environment)) {
		const value = type.typeArguments?.params[1] ?? null;
		return value === null ? [] : [{ type: value, substitutions }];
	}
	if ((name === "Pick" || name === "Omit") && isBuiltIn(name, environment)) {
		const source = type.typeArguments?.params[0];
		return source === undefined
			? []
			: dictionaryValueTypes(source, environment, substitutions, resolvingAliases);
	}
	return undefined;
}

function referenceValueTypes(
	type: ESTree.TSTypeReference,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): readonly ResolvedType[] {
	const name = typeReferenceName(type);
	if (name === null) return [];

	const substitution = substitutions.get(name);
	if (substitution !== undefined) {
		return isUnappliedReferenceTo(substitution, name)
			? []
			: dictionaryValueTypes(substitution, environment, substitutions, resolvingAliases);
	}

	const transparent = transparentValueTypes(name, type, environment, substitutions, resolvingAliases);
	if (transparent !== undefined) return transparent;

	const builtIn = builtInValueTypes(name, type, environment, substitutions, resolvingAliases);
	if (builtIn !== undefined) return builtIn;

	const alias = environment.aliases.get(name);
	if (alias === undefined || resolvingAliases.has(name)) return [];
	const nextSubstitutions = aliasSubstitution(alias, type, substitutions);
	if (nextSubstitutions === null) return [];
	const nextResolving = new Set(resolvingAliases);
	nextResolving.add(name);
	return dictionaryValueTypes(alias.typeAnnotation, environment, nextSubstitutions, nextResolving);
}

function dictionaryValueTypes(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): readonly ResolvedType[] {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.type === "TSTypeLiteral") return literalValueTypes(unwrapped, substitutions);
	if (unwrapped.type === "TSMappedType") return mappedValueTypes(unwrapped, substitutions);
	if (unwrapped.type !== "TSTypeReference") return [];
	return referenceValueTypes(unwrapped, environment, substitutions, resolvingAliases);
}

export function classifyUnsafeDictionaryValue(
	valueType: ESTree.TSType,
	environment: TypeEnvironment,
): UnsafeDictionary | null {
	const unsafeValue = unsafeDirectValue(valueType, environment, new Map(), new Set());
	return unsafeValue === null ? null : { kind: "unsafe-dictionary", unsafeValue };
}

export function classifyUnsafeDictionary(
	type: ESTree.TSType,
	environment: TypeEnvironment,
): UnsafeDictionary | null {
	for (const valueType of dictionaryValueTypes(type, environment, new Map(), new Set())) {
		const unsafeValue = unsafeDirectValue(
			valueType.type,
			environment,
			valueType.substitutions,
			new Set(),
		);
		if (unsafeValue !== null) return { kind: "unsafe-dictionary", unsafeValue };
	}
	return null;
}

function resolvesToDictionary(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): boolean {
	return dictionaryValueTypes(type, environment, substitutions, resolvingAliases).length > 0;
}

function literalWideningTarget(type: ESTree.TSTypeLiteral): WideningTarget | null {
	if (type.members.some((member) => member.type === "TSIndexSignature")) {
		return { kind: "open dictionary" };
	}
	return type.members.length > 0 ? { kind: "anonymous object" } : null;
}

function aliasWideningTarget(
	alias: ESTree.TSTypeAliasDeclaration,
	reference: ESTree.TSTypeReference,
	environment: TypeEnvironment,
	name: string,
): WideningTarget | null {
	const substitutions = aliasSubstitution(alias, reference, new Map());
	if (substitutions === null) return null;
	if ((alias.typeParameters?.params.length ?? 0) > 0) {
		return resolvesToDictionary(alias.typeAnnotation, environment, substitutions, new Set([name]))
			? { kind: "generic container" }
			: null;
	}
	return classifyAliasBroadTarget(alias.typeAnnotation, environment, substitutions, new Set([name]));
}

function referenceWideningTarget(
	type: ESTree.TSTypeReference,
	environment: TypeEnvironment,
): WideningTarget | null {
	const name = typeReferenceName(type);
	if (name === null) return null;
	if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
		const wrapped = type.typeArguments?.params[0];
		return wrapped === undefined ? null : classifyWideningTarget(wrapped, environment);
	}
	if (name === "Record" && isBuiltIn(name, environment)) return { kind: "open dictionary" };
	const alias = environment.aliases.get(name);
	if (alias === undefined) return null;
	return aliasWideningTarget(alias, type, environment, name);
}

export function classifyWideningTarget(
	type: ESTree.TSType,
	environment: TypeEnvironment,
): WideningTarget | null {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.type === "TSUnknownKeyword") return { kind: "unknown" };
	if (unwrapped.type === "TSObjectKeyword") return { kind: "object" };
	if (unwrapped.type === "TSTypeLiteral") return literalWideningTarget(unwrapped);
	if (unwrapped.type === "TSMappedType") return { kind: "open dictionary" };
	if (unwrapped.type !== "TSTypeReference") return null;
	return referenceWideningTarget(unwrapped, environment);
}

function isBroadMappedKey(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
): boolean {
	const unwrapped = unwrapTransparentType(type);
	if (
		unwrapped.type === "TSStringKeyword" ||
		unwrapped.type === "TSNumberKeyword" ||
		unwrapped.type === "TSSymbolKeyword"
	) {
		return true;
	}
	if (unwrapped.type === "TSUnionType") {
		return unwrapped.types.every((member) =>
			isBroadMappedKey(member, environment, substitutions),
		);
	}
	if (unwrapped.type !== "TSTypeReference") return false;
	const name = typeReferenceName(unwrapped);
	if (name === null) return false;
	const substitution = substitutions.get(name);
	if (substitution !== undefined && !isUnappliedReferenceTo(substitution, name)) {
		return isBroadMappedKey(substitution, environment, substitutions);
	}
	return name === "PropertyKey" && isBuiltIn(name, environment);
}

function indexedBroadTarget(type: ESTree.TSTypeLiteral): WideningTarget | null {
	return type.members.some((member) => member.type === "TSIndexSignature")
		? { kind: "open dictionary" }
		: null;
}

function mappedBroadTarget(
	type: ESTree.TSMappedType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
): WideningTarget | null {
	return isBroadMappedKey(type.constraint, environment, substitutions)
		? { kind: "open dictionary" }
		: null;
}

function broadReferenceTarget(
	type: ESTree.TSTypeReference,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): WideningTarget | null {
	const name = typeReferenceName(type);
	if (name === null) return null;
	const substitution = substitutions.get(name);
	if (substitution !== undefined) {
		return isUnappliedReferenceTo(substitution, name)
			? null
			: classifyAliasBroadTarget(substitution, environment, substitutions, resolvingAliases);
	}
	if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
		const wrapped = type.typeArguments?.params[0];
		return wrapped === undefined
			? null
			: classifyAliasBroadTarget(wrapped, environment, substitutions, resolvingAliases);
	}
	if (name === "Record" && isBuiltIn(name, environment)) {
		return { kind: "open dictionary" };
	}
	const alias = environment.aliases.get(name);
	if (alias === undefined || resolvingAliases.has(name)) return null;
	const nextSubstitutions = aliasSubstitution(alias, type, substitutions);
	if (nextSubstitutions === null) return null;
	const nextResolving = new Set(resolvingAliases);
	nextResolving.add(name);
	return classifyAliasBroadTarget(alias.typeAnnotation, environment, nextSubstitutions, nextResolving);
}

function classifyAliasBroadTarget(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): WideningTarget | null {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.type === "TSUnknownKeyword") return { kind: "unknown" };
	if (unwrapped.type === "TSObjectKeyword") return { kind: "object" };
	if (unwrapped.type === "TSTypeLiteral") return indexedBroadTarget(unwrapped);
	if (unwrapped.type === "TSMappedType") {
		return mappedBroadTarget(unwrapped, environment, substitutions);
	}
	if (unwrapped.type !== "TSTypeReference") return null;
	return broadReferenceTarget(unwrapped, environment, substitutions, resolvingAliases);
}

export function isPopulatedObjectExpression(expression: ESTree.Expression): boolean {
	let current = expression;
	while (
		current.type === "ParenthesizedExpression" ||
		current.type === "TSAsExpression" ||
		current.type === "TSTypeAssertion" ||
		current.type === "TSNonNullExpression"
	) {
		current = current.expression;
	}
	return current.type === "ObjectExpression" && current.properties.length > 0;
}

export function isKnownEvidenceExpression(expression: ESTree.Expression): boolean {
	let current = expression;
	while (
		current.type === "ParenthesizedExpression" ||
		current.type === "TSAsExpression" ||
		current.type === "TSTypeAssertion" ||
		current.type === "TSNonNullExpression" ||
		current.type === "TSSatisfiesExpression"
	) {
		current = current.expression;
	}
	if (current.type === "ObjectExpression") return true;
	return (
		current.type === "ArrayExpression" ||
		current.type === "ArrowFunctionExpression" ||
		current.type === "ClassExpression" ||
		current.type === "FunctionExpression" ||
		current.type === "NewExpression" ||
		current.type === "Literal" ||
		current.type === "TemplateLiteral" ||
		current.type === "UnaryExpression"
	);
}
