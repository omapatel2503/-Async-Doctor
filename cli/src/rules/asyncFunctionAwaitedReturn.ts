
import { AST_NODE_TYPES, TSESLint, TSESTree } from '@typescript-eslint/utils';

type FunctionNode =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

type NodeWithParent<T extends TSESTree.Node> = T & { parent?: TSESTree.Node | null };

const asyncAwaitedReturnRule: TSESLint.RuleModule<'noReturnAwait', unknown[]> = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow returning an awaited value in async functions',
      recommended: false
    },
    fixable: 'code',
    messages: {
      noReturnAwait: "Remove unnecessary 'await' in return; it adds extra microtask delay."
    },
    schema: []
  },
  defaultOptions: [],
  create(context: TSESLint.RuleContext<'noReturnAwait', unknown[]>) {
    return {
      ReturnStatement(node: NodeWithParent<TSESTree.ReturnStatement>) {
        const argument = node.argument;
        if (!argument || argument.type !== AST_NODE_TYPES.AwaitExpression) {
          return;
        }

        const ancestors = context.getAncestors() as TSESTree.Node[];
        const func = [...ancestors].reverse().find((ancestor): ancestor is FunctionNode => {
          switch (ancestor.type) {
            case AST_NODE_TYPES.FunctionDeclaration:
            case AST_NODE_TYPES.FunctionExpression:
            case AST_NODE_TYPES.ArrowFunctionExpression:
              return true;
            default:
              return false;
          }
        });

        if (!func || !func.async) {
          return;
        }

        context.report({
          node: argument,
          messageId: 'noReturnAwait',
          fix(fixer: TSESLint.RuleFixer) {
            if (ancestors.some(ancestor => ancestor.type === AST_NODE_TYPES.TryStatement)) {
              return null;
            }

            const sourceCode = context.getSourceCode();
            const awaitToken = sourceCode.getFirstToken(argument);
            if (!awaitToken) {
              return null;
            }

            return fixer.remove(awaitToken);
          }
        });
      }
    };
  }
};

export default asyncAwaitedReturnRule;
