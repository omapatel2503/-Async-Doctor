"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// redundant-new-promise-wrapper.ts
const utils_1 = require("@typescript-eslint/utils");
const isIdent = (node, name) => node.type === utils_1.AST_NODE_TYPES.Identifier && node.name === name;
const redundantNewPromiseWrapperRule = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Detect redundant new Promise wrappers that just forward another promise (e.g., p.then(resolve, reject)).',
            recommended: false
        },
        fixable: 'code',
        messages: {
            redundantWrapper: 'Redundant Promise wrapper; return/await the underlying promise directly.'
        },
        schema: []
    },
    defaultOptions: [],
    create(context) {
        return {
            NewExpression(node) {
                if (node.callee.type !== utils_1.AST_NODE_TYPES.Identifier ||
                    node.callee.name !== 'Promise' ||
                    node.arguments.length !== 1) {
                    return;
                }
                const executor = node.arguments[0];
                if (!executor ||
                    (executor.type !== utils_1.AST_NODE_TYPES.FunctionExpression &&
                        executor.type !== utils_1.AST_NODE_TYPES.ArrowFunctionExpression)) {
                    return;
                }
                let isRedundant = false;
                let replacement = null;
                const src = context.getSourceCode();
                const firstExprStmt = executor.body.type === utils_1.AST_NODE_TYPES.BlockStatement
                    ? executor.body.body.find(stmt => stmt.type === utils_1.AST_NODE_TYPES.ExpressionStatement)
                    : undefined;
                if (firstExprStmt &&
                    firstExprStmt.expression.type === utils_1.AST_NODE_TYPES.CallExpression) {
                    const thenCall = firstExprStmt.expression;
                    const member = thenCall.callee;
                    if (member.type === utils_1.AST_NODE_TYPES.MemberExpression &&
                        member.property.type === utils_1.AST_NODE_TYPES.Identifier &&
                        member.property.name === 'then' &&
                        thenCall.arguments.length >= 1) {
                        const args = thenCall.arguments;
                        if (args.length >= 1 &&
                            executor.params.length >= 1 &&
                            executor.params[0].type === utils_1.AST_NODE_TYPES.Identifier &&
                            isIdent(args[0], executor.params[0].name)) {
                            const base = src.getText(member.object);
                            if (args.length >= 2 &&
                                executor.params.length >= 2 &&
                                executor.params[1].type === utils_1.AST_NODE_TYPES.Identifier &&
                                isIdent(args[1], executor.params[1].name)) {
                                isRedundant = true;
                                replacement = base;
                            }
                            else {
                                isRedundant = true;
                                replacement = base;
                            }
                        }
                    }
                }
                if (!isRedundant && executor.params.length >= 1) {
                    const resParam = executor.params[0];
                    if (resParam.type === utils_1.AST_NODE_TYPES.Identifier) {
                        if (executor.body.type === utils_1.AST_NODE_TYPES.BlockStatement) {
                            const only = executor.body.body.length === 1 ? executor.body.body[0] : undefined;
                            if (only &&
                                only.type === utils_1.AST_NODE_TYPES.ExpressionStatement &&
                                only.expression.type === utils_1.AST_NODE_TYPES.CallExpression) {
                                const call = only.expression;
                                if (call.callee.type === utils_1.AST_NODE_TYPES.Identifier &&
                                    call.callee.name === resParam.name &&
                                    call.arguments.length === 1) {
                                    const arg = call.arguments[0];
                                    if (arg.type === utils_1.AST_NODE_TYPES.Identifier ||
                                        arg.type === utils_1.AST_NODE_TYPES.CallExpression ||
                                        arg.type === utils_1.AST_NODE_TYPES.MemberExpression) {
                                        isRedundant = true;
                                        replacement = src.getText(arg);
                                    }
                                }
                            }
                        }
                    }
                }
                if (isRedundant && replacement) {
                    context.report({
                        node,
                        messageId: 'redundantWrapper',
                        fix: fixer => fixer.replaceText(node, replacement)
                    });
                }
            }
        };
    }
};
exports.default = redundantNewPromiseWrapperRule;
