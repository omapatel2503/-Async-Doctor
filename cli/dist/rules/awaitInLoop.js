"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@typescript-eslint/utils");
const awaitInLoopRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow using await inside loops',
            recommended: false
        },
        messages: {
            noAwaitInLoop: "Avoid using 'await' inside a loop; it serializes loop iterations."
        },
        schema: []
    },
    defaultOptions: [],
    create(context) {
        return {
            AwaitExpression(node) {
                const loops = new Set([
                    utils_1.AST_NODE_TYPES.ForStatement,
                    utils_1.AST_NODE_TYPES.ForInStatement,
                    utils_1.AST_NODE_TYPES.ForOfStatement,
                    utils_1.AST_NODE_TYPES.WhileStatement,
                    utils_1.AST_NODE_TYPES.DoWhileStatement
                ]);
                for (const ancestor of context.getAncestors()) {
                    if (!loops.has(ancestor.type)) {
                        continue;
                    }
                    if (ancestor.type === utils_1.AST_NODE_TYPES.ForOfStatement &&
                        ancestor.await) {
                        continue;
                    }
                    context.report({
                        node,
                        messageId: 'noAwaitInLoop'
                    });
                    break;
                }
            }
        };
    }
};
exports.default = awaitInLoopRule;
