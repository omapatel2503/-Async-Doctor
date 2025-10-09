
import { AST_NODE_TYPES, TSESLint, TSESTree } from '@typescript-eslint/utils';

type NodeWithParent<T extends TSESTree.Node> = T & { parent?: TSESTree.Node | null };

const promiseResolveThenRule: TSESLint.RuleModule<'avoidResolveThen', unknown[]> = {
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
  create(context: TSESLint.RuleContext<'avoidResolveThen', unknown[]>) {
    return {
      CallExpression(node: NodeWithParent<TSESTree.CallExpression>) {
        if (
          node.callee.type === AST_NODE_TYPES.MemberExpression &&
          node.callee.property.type === AST_NODE_TYPES.Identifier &&
          node.callee.property.name === 'then'
        ) {
          const obj = node.callee.object;
          if (
            obj.type === AST_NODE_TYPES.CallExpression &&
            obj.callee.type === AST_NODE_TYPES.MemberExpression &&
            obj.callee.object.type === AST_NODE_TYPES.Identifier &&
            obj.callee.object.name === 'Promise' &&
            obj.callee.property.type === AST_NODE_TYPES.Identifier &&
            obj.callee.property.name === 'resolve'
          ) {
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

export default promiseResolveThenRule;
