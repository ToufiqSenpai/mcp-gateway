import { defineConfig } from "oxlint"

export default defineConfig({
  plugins: ["typescript", "vitest", "node"],
  categories: {},
  options: { typeAware: true },
  env: { builtin: true },
  ignorePatterns: [
    "dist/",
    "node_modules/",
    "coverage/",
    ".wrangler/",
    ".agents/**",
    ".codebuddy/**",
    ".opencode/**",
    ".specify/**",
    "tools/oxlint/anti-slop/**",
    "packages/web/src/admin/app.generated.css"
  ],
  jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }],
  rules: {
    // anti-slop
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",

    // eslint - correctness
    "no-unused-expressions": "error",
    "no-unused-vars": [
      "warn",
      {
        args: "after-used",
        argsIgnorePattern: "^_",
        caughtErrors: "none",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
        vars: "all",
        varsIgnorePattern: "^_"
      }
    ],

    // eslint - pedantic
    eqeqeq: "error",
    "no-array-constructor": "error",

    // eslint - style
    "default-param-last": "error",
    "object-shorthand": ["error", "always"],

    // node - restriction
    "node/no-path-concat": "error",

    // typescript - correctness
    "typescript/await-thenable": "error",
    "typescript/no-array-delete": "error",
    "typescript/no-base-to-string": "error",
    "typescript/no-duplicate-enum-values": "error",
    "typescript/no-duplicate-type-constituents": "error",
    "typescript/no-extra-non-null-assertion": "error",
    "typescript/no-floating-promises": "warn",
    "typescript/no-for-in-array": "error",
    "typescript/no-implied-eval": "error",
    "typescript/no-meaningless-void-operator": "error",
    "typescript/no-misused-new": "error",
    "typescript/no-misused-spread": "error",
    "typescript/no-non-null-asserted-optional-chain": "error",
    "typescript/no-redundant-type-constituents": "error",
    "typescript/no-this-alias": "error",
    "typescript/no-unnecessary-parameter-property-assignment": "error",
    "typescript/no-unsafe-declaration-merging": "error",
    "typescript/no-unsafe-unary-minus": "error",
    "typescript/no-useless-default-assignment": "error",
    "typescript/no-useless-empty-export": "error",
    "typescript/no-wrapper-object-types": "error",
    "typescript/prefer-as-const": "error",
    "typescript/prefer-namespace-keyword": "error",
    "typescript/require-array-sort-compare": "error",
    "typescript/restrict-template-expressions": "error",
    "typescript/triple-slash-reference": "error",
    "typescript/unbound-method": "error",

    // typescript - style
    "typescript/adjacent-overload-signatures": "error",
    "typescript/array-type": "error",
    "typescript/ban-tslint-comment": "error",
    "typescript/class-literal-property-style": "error",
    "typescript/consistent-generic-constructors": ["error", "constructor"],
    "typescript/consistent-indexed-object-style": ["error", "record"],
    "typescript/consistent-type-assertions": [
      "error",
      {
        assertionStyle: "as",
        objectLiteralTypeAssertions: "allow"
      }
    ],
    "typescript/consistent-type-definitions": ["error", "interface"],
    "typescript/consistent-type-exports": "error",
    "typescript/no-inferrable-types": "error",
    "typescript/no-unnecessary-qualifier": "error",
    "typescript/prefer-for-of": "error",
    "typescript/prefer-function-type": "error",

    // typescript - pedantic
    "typescript/ban-ts-comment": "error",
    "typescript/no-confusing-void-expression": "off",
    "typescript/no-mixed-enums": "error",
    "typescript/no-unsafe-function-type": "error",

    // typescript - suspicious
    "typescript/no-confusing-non-null-assertion": "error",
    "typescript/no-unnecessary-template-expression": "error",
    "typescript/no-unnecessary-type-assertion": "error",
    "typescript/no-unnecessary-type-constraint": "error",
    "typescript/no-unnecessary-type-conversion": "error",
    "typescript/no-unsafe-enum-comparison": "error",

    // typescript - restriction
    "typescript/explicit-member-accessibility": "error",
    "typescript/no-empty-object-type": "error",
    "typescript/no-explicit-any": "warn",
    "typescript/no-import-type-side-effects": "error",
    "typescript/no-require-imports": "error",

    // typescript - nursery
    "typescript/no-unnecessary-condition": ["error", { allowConstantLoopConditions: true }]
  }
})
