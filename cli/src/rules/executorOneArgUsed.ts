
import { AST_NODE_TYPES, TSESLint, TSESTree } from '@typescript-eslint/utils';
import { visitorKeys as defaultVisitorKeys } from '@typescript-eslint/visitor-keys';

type NodeWithParent<T extends TSESTree.Node> = T & { parent?: TSESTree.Node | null };

const executorOneArgUsedRule: TSESLint.RuleModule<'oneArgExecutor', unknown[]> = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Detect Promise constructors that use only one of resolve/reject',
      recommended: false
    },
    messages: {
      oneArgExecutor: 'Promise executor uses only one of its callbacks (resolve/reject), indicating incomplete handling.'
    },
    schema: []
  },
  defaultOptions: [],
  create(context: TSESLint.RuleContext<'oneArgExecutor', unknown[]>) {
    const isNode = (value: unknown): value is TSESTree.Node =>
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      typeof (value as { type?: unknown }).type === 'string';

    const traversalKeys = context.getSourceCode().visitorKeys ?? defaultVisitorKeys;

    function isIdentifierUsed(
      name: string,
      func: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression
    ): boolean {
      let used = false;
      const seen = new Set<TSESTree.Node>();
      const stack: Array<{ node: TSESTree.Node; parent: TSESTree.Node | null }> = [
        { node: func.body, parent: func }
      ];

      while (stack.length && !used) {
        const { node, parent } = stack.pop()!;
        if (seen.has(node)) {
          continue;
        }
        seen.add(node);

        if (
          (node.type === AST_NODE_TYPES.FunctionExpression ||
            node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
            node.type === AST_NODE_TYPES.FunctionDeclaration) &&
          node !== func
        ) {
          const shadowed = node.params.some((param): param is TSESTree.Identifier =>
            param.type === AST_NODE_TYPES.Identifier && param.name === name
          );
          if (shadowed) {
            continue;
          }
        }

        if (node.type === AST_NODE_TYPES.Identifier && node.name === name) {
          if (
            parent &&
            parent.type === AST_NODE_TYPES.MemberExpression &&
            parent.property === node &&
            !parent.computed
          ) {
            // property named like the identifier (not a variable usage)
          } else {
            used = true;
            break;
          }
        }

        const keys = (traversalKeys as Record<string, readonly string[]>)[node.type] ?? [];
        for (const key of keys) {
          const value = (node as unknown as Record<string, unknown>)[key];
          if (!value) {
            continue;
          }

          if (Array.isArray(value)) {
            for (const child of value) {
              if (isNode(child)) {
                stack.push({ node: child, parent: node });
              }
            }
          } else if (isNode(value)) {
            stack.push({ node: value, parent: node });
          }
        }
      }

      return used;
    }

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
            const params = executor.params;
            const resolveParam =
              params[0] && params[0].type === AST_NODE_TYPES.Identifier ? params[0].name : null;
            const rejectParam =
              params[1] && params[1].type === AST_NODE_TYPES.Identifier ? params[1].name : null;
            let usesResolve = false;
            let usesReject = false;

            if (resolveParam) {
              usesResolve = isIdentifierUsed(resolveParam, executor);
            }
            if (rejectParam) {
              usesReject = isIdentifierUsed(rejectParam, executor);
            }

            const paramCount = params.length;
            if (paramCount < 2 || !(usesResolve && usesReject)) {
              context.report({
                node: executor,
                messageId: 'oneArgExecutor'
              });
            }
          }
        }
      }
    };
  }
};

export default executorOneArgUsedRule;
