
import { AST_NODE_TYPES, TSESLint, TSESTree } from '@typescript-eslint/utils';

type NodeWithParent<T extends TSESTree.Node> = T & { parent?: TSESTree.Node | null };

const awaitInLoopRule: TSESLint.RuleModule<'noAwaitInLoop', unknown[]> = {
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
  create(context: TSESLint.RuleContext<'noAwaitInLoop', unknown[]>) {
    return {
      AwaitExpression(node: NodeWithParent<TSESTree.AwaitExpression>) {
        const loops = new Set<AST_NODE_TYPES>([
          AST_NODE_TYPES.ForStatement,
          AST_NODE_TYPES.ForInStatement,
          AST_NODE_TYPES.ForOfStatement,
          AST_NODE_TYPES.WhileStatement,
          AST_NODE_TYPES.DoWhileStatement
        ]);

        for (const ancestor of context.getAncestors() as TSESTree.Node[]) {
          if (!loops.has(ancestor.type)) {
            continue;
          }

          if (
            ancestor.type === AST_NODE_TYPES.ForOfStatement &&
            (ancestor as TSESTree.ForOfStatement).await
          ) {
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

export default awaitInLoopRule;
