const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;
const HOOK_NAME = /^use([A-Z0-9]|$)/;

function isAllowedName(name) {
  return PASCAL_CASE.test(name) || HOOK_NAME.test(name);
}

function hasUseClientDirective(programNode) {
  for (const stmt of programNode.body) {
    if (stmt.type !== "ExpressionStatement" || !stmt.directive) break;
    if (stmt.directive === "use client") return true;
  }
  return false;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow named exports from a "use client" module whose identifier is not a component (PascalCase) or a hook (use-prefixed). Such exports become opaque client references when imported by server code and throw if called.',
    },
    schema: [],
    messages: {
      nonComponentExport:
        "'{{name}}' is exported from a \"use client\" file but isn't PascalCase (component) or use-prefixed (hook). Non-component exports become inert client references when imported by server code and throw if called — move it to a module without \"use client\".",
    },
  },
  create(context) {
    return {
      Program(node) {
        if (!hasUseClientDirective(node)) return;

        for (const stmt of node.body) {
          if (stmt.type !== "ExportNamedDeclaration" || stmt.exportKind === "type") {
            continue;
          }

          if (stmt.declaration) {
            const decl = stmt.declaration;

            if (decl.type === "TSTypeAliasDeclaration" || decl.type === "TSInterfaceDeclaration") {
              continue;
            }

            if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
              if (decl.id && !isAllowedName(decl.id.name)) {
                context.report({ node: decl.id, messageId: "nonComponentExport", data: { name: decl.id.name } });
              }
            } else if (decl.type === "VariableDeclaration") {
              for (const declarator of decl.declarations) {
                if (declarator.id.type === "Identifier" && !isAllowedName(declarator.id.name)) {
                  context.report({
                    node: declarator.id,
                    messageId: "nonComponentExport",
                    data: { name: declarator.id.name },
                  });
                }
              }
            }
          } else if (stmt.specifiers) {
            for (const spec of stmt.specifiers) {
              if (spec.exportKind === "type") continue;
              const exportedName = spec.exported.name;
              if (exportedName && !isAllowedName(exportedName)) {
                context.report({ node: spec.exported, messageId: "nonComponentExport", data: { name: exportedName } });
              }
            }
          }
        }
      },
    };
  },
};

module.exports = {
  rules: {
    "no-non-component-client-exports": rule,
  },
};
