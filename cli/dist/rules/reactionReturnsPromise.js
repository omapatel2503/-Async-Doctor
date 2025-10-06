"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// reaction-returns-promise.ts
const utils_1 = require("@typescript-eslint/utils");
const isPromiseStatic = (call, method) => {
    const callee = call.callee;
    if (callee.type !== utils_1.AST_NODE_TYPES.MemberExpression) {
        return false;
    }
    const object = callee.object;
    if (object.type !== utils_1.AST_NODE_TYPES.Identifier || object.name !== 'Promise') {
        return false;
    }
    const property = callee.property;
    return property.type === utils_1.AST_NODE_TYPES.Identifier && property.name === method;
};
const isThenCatchFinallyMember = (expr) => expr.property.type === utils_1.AST_NODE_TYPES.Identifier &&
    ['then', 'catch', 'finally'].includes(expr.property.name);
const formatArrowParams = (params, sourceCode) => {
    if (params.length === 0) {
        return '()';
    }
    if (params.length === 1 && params[0].type === utils_1.AST_NODE_TYPES.Identifier) {
        return sourceCode.getText(params[0]);
    }
    const rendered = params.map(param => sourceCode.getText(param)).join(', ');
    return `(${rendered})`;
};
const reactionReturnsPromiseRule = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Avoid returning Promise.resolve/reject inside .then/.catch/.finally callbacks; return the value or throw instead.',
            recommended: false
        },
        fixable: 'code',
        messages: {
            noReturnPromiseInReaction: 'Return the value (for resolve) or throw the error (for reject) instead of wrapping with Promise.resolve/reject.'
        },
        schema: []
    },
    defaultOptions: [],
    create(context) {
        return {
            ReturnStatement(node) {
                const arg = node.argument;
                if (!arg || arg.type !== utils_1.AST_NODE_TYPES.CallExpression) {
                    return;
                }
                const func = context
                    .getAncestors()
                    .reverse()
                    .find((ancestor) => {
                    if (!ancestor.parent ||
                        ancestor.parent.type !== utils_1.AST_NODE_TYPES.CallExpression ||
                        ancestor.parent.callee.type !== utils_1.AST_NODE_TYPES.MemberExpression) {
                        return false;
                    }
                    return ((ancestor.type === utils_1.AST_NODE_TYPES.ArrowFunctionExpression ||
                        ancestor.type === utils_1.AST_NODE_TYPES.FunctionExpression) &&
                        isThenCatchFinallyMember(ancestor.parent.callee));
                });
                if (!func) {
                    return;
                }
                if (isPromiseStatic(arg, 'resolve') || isPromiseStatic(arg, 'reject')) {
                    context.report({
                        node: arg,
                        messageId: 'noReturnPromiseInReaction',
                        fix(fixer) {
                            const src = context.getSourceCode();
                            const callee = arg.callee;
                            const property = callee.property;
                            const inner = arg.arguments.length > 0 ? src.getText(arg.arguments[0]) : 'undefined';
                            if (property.name === 'resolve') {
                                return fixer.replaceText(node, `return ${inner};`);
                            }
                            return fixer.replaceText(node, `throw ${inner};`);
                        }
                    });
                }
            },
            'ArrowFunctionExpression:exit'(node) {
                const parent = node.parent;
                if (!parent ||
                    parent.type !== utils_1.AST_NODE_TYPES.CallExpression ||
                    parent.callee.type !== utils_1.AST_NODE_TYPES.MemberExpression ||
                    !isThenCatchFinallyMember(parent.callee)) {
                    return;
                }
                if (node.body.type !== utils_1.AST_NODE_TYPES.CallExpression) {
                    return;
                }
                const call = node.body;
                if (!isPromiseStatic(call, 'resolve') && !isPromiseStatic(call, 'reject')) {
                    return;
                }
                const src = context.getSourceCode();
                const callee = call.callee;
                const property = callee.property;
                const inner = call.arguments.length > 0 ? src.getText(call.arguments[0]) : 'undefined';
                context.report({
                    node: call,
                    messageId: 'noReturnPromiseInReaction',
                    fix(fixer) {
                        if (property.name === 'resolve') {
                            return fixer.replaceText(call, inner);
                        }
                        if (!node.expression) {
                            return null;
                        }
                        const paramsText = formatArrowParams(node.params, src);
                        const asyncPrefix = node.async ? 'async ' : '';
                        return fixer.replaceText(node, `${asyncPrefix}${paramsText} => { throw ${inner}; }`);
                    }
                });
            }
        };
    }
};
exports.default = reactionReturnsPromiseRule;
