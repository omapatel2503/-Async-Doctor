"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@typescript-eslint/utils");
const promiseResolveThenRule = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Detect Promise.resolve().then(...) chains',
            recommended: false
        },
        messages: {
            avoidResolveThen: "Avoid using Promise.resolve().then(); use async/await or direct code instead."
        },
        schema: []
    },
    defaultOptions: [],
    create(context) {
        return {
            CallExpression(node) {
                if (node.callee.type === utils_1.AST_NODE_TYPES.MemberExpression &&
                    node.callee.property.type === utils_1.AST_NODE_TYPES.Identifier &&
                    node.callee.property.name === 'then') {
                    const obj = node.callee.object;
                    if (obj.type === utils_1.AST_NODE_TYPES.CallExpression &&
                        obj.callee.type === utils_1.AST_NODE_TYPES.MemberExpression &&
                        obj.callee.object.type === utils_1.AST_NODE_TYPES.Identifier &&
                        obj.callee.object.name === 'Promise' &&
                        obj.callee.property.type === utils_1.AST_NODE_TYPES.Identifier &&
                        obj.callee.property.name === 'resolve') {
                        context.report({
                            node,
                            messageId: 'avoidResolveThen'
                        });
                    }
                }
            }
        };
    }
};
exports.default = promiseResolveThenRule;
