
import { AST_NODE_TYPES, TSESLint, TSESTree } from '@typescript-eslint/utils';

type NodeWithParent<T extends TSESTree.Node> = T & { parent?: TSESTree.Node | null };

const customPromisificationRule: TSESLint.RuleModule<'avoidNewPromise', unknown[]> = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Detect manual Promise construction (custom promisification)',
      recommended: false
    },
    messages: {
      avoidNewPromise: 'Avoid manual Promise construction; use async/await or built-in Promise APIs instead.'
    },
    schema: []
  },
  defaultOptions: [],
  create(context: TSESLint.RuleContext<'avoidNewPromise', unknown[]>) {
    return {
      NewExpression(node: NodeWithParent<TSESTree.NewExpression>) {
        if (
          node.callee.type === AST_NODE_TYPES.Identifier &&
          node.callee.name === 'Promise' &&
          node.arguments.length === 1
        ) {
          const executor = node.arguments[0];
          if (
            executor &&
            (executor.type === AST_NODE_TYPES.FunctionExpression ||
              executor.type === AST_NODE_TYPES.ArrowFunctionExpression)
          ) {
            context.report({
              node,
              messageId: 'avoidNewPromise'
            });
          }
        }
      }
    };
  }
};

export default customPromisificationRule;
