// async-executor-in-promise.ts
import { AST_NODE_TYPES, TSESLint, TSESTree } from '@typescript-eslint/utils';

type NodeWithParent<T extends TSESTree.Node> = T & { parent?: TSESTree.Node | null };

const asyncExecutorInPromiseRule: TSESLint.RuleModule<'noAsyncExecutor', unknown[]> = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow async functions as Promise executors.',
      recommended: false
    },
    fixable: 'code',
    messages: {
      noAsyncExecutor:
        'Avoid using an async Promise executor; it can cause unhandled rejections. Use a synchronous executor and call resolve/reject.'
    },
    schema: []
  },
  defaultOptions: [],
  create(context) {
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
              executor.type === AST_NODE_TYPES.ArrowFunctionExpression) &&
            executor.async
          ) {
            context.report({
              node: executor,
              messageId: 'noAsyncExecutor',
              fix: fixer => {
                // Safe, minimal fix: drop the `async` keyword on the executor
                // (keeps semantics closest while avoiding hidden async errors)
                const src = context.getSourceCode();
                const firstToken = src.getFirstToken(executor);
                if (firstToken && firstToken.value === 'async') {
                  return fixer.remove(firstToken);
                }
                return null;
              }
            });
          }
        }
      }
    };
  }
};

export default asyncExecutorInPromiseRule;
