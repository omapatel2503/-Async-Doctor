
// reaction-returns-promise.ts
import { AST_NODE_TYPES, TSESLint, TSESTree } from '@typescript-eslint/utils';

type NodeWithParent<T extends TSESTree.Node> = T & { parent?: TSESTree.Node | null };

const isPromiseStatic = (
  call: TSESTree.CallExpression,
  method: 'resolve' | 'reject'
): boolean => {
  const callee = call.callee;
  if (callee.type !== AST_NODE_TYPES.MemberExpression) {
    return false;
  }

  const object = callee.object;
  if (object.type !== AST_NODE_TYPES.Identifier || object.name !== 'Promise') {
    return false;
  }

  const property = callee.property;
  return property.type === AST_NODE_TYPES.Identifier && property.name === method;
};

const isThenCatchFinallyMember = (expr: TSESTree.MemberExpression): boolean =>
  expr.property.type === AST_NODE_TYPES.Identifier &&
  ['then', 'catch', 'finally'].includes(expr.property.name);

const formatArrowParams = (
  params: TSESTree.Parameter[],
  sourceCode: TSESLint.SourceCode
): string => {
  if (params.length === 0) {
    return '()';
  }

  if (params.length === 1 && params[0].type === AST_NODE_TYPES.Identifier) {
    return sourceCode.getText(params[0]);
  }

  const rendered = params.map(param => sourceCode.getText(param)).join(', ');
  return `(${rendered})`;
};

const reactionReturnsPromiseRule: TSESLint.RuleModule<'noReturnPromiseInReaction', unknown[]> = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Avoid returning Promise.resolve/reject inside .then/.catch/.finally callbacks; return the value or throw instead.',
      recommended: false
    },
    fixable: 'code',
    messages: {
      noReturnPromiseInReaction:
        'Return the value (for resolve) or throw the error (for reject) instead of wrapping with Promise.resolve/reject.'
    },
    schema: []
  },
  defaultOptions: [],
  create(context: TSESLint.RuleContext<'noReturnPromiseInReaction', unknown[]>) {
    return {
      ReturnStatement(node: NodeWithParent<TSESTree.ReturnStatement>) {
        const arg = node.argument;
        if (!arg || arg.type !== AST_NODE_TYPES.CallExpression) {
          return;
        }

        const func = context
          .getAncestors()
          .reverse()
          .find(
            (ancestor): ancestor is TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression => {
              if (
                !ancestor.parent ||
                ancestor.parent.type !== AST_NODE_TYPES.CallExpression ||
                ancestor.parent.callee.type !== AST_NODE_TYPES.MemberExpression
              ) {
                return false;
              }

              return (
                (ancestor.type === AST_NODE_TYPES.ArrowFunctionExpression ||
                  ancestor.type === AST_NODE_TYPES.FunctionExpression) &&
                isThenCatchFinallyMember(ancestor.parent.callee)
              );
            }
          );

        if (!func) {
          return;
        }

        if (isPromiseStatic(arg, 'resolve') || isPromiseStatic(arg, 'reject')) {
          context.report({
            node: arg,
            messageId: 'noReturnPromiseInReaction',
            fix(fixer) {
              const src = context.getSourceCode();
              const callee = arg.callee as TSESTree.MemberExpression;
              const property = callee.property as TSESTree.Identifier;
              const inner = arg.arguments.length > 0 ? src.getText(arg.arguments[0]) : 'undefined';

              if (property.name === 'resolve') {
                return fixer.replaceText(node, `return ${inner};`);
              }

              return fixer.replaceText(node, `throw ${inner};`);
            }
          });
        }
      },

      'ArrowFunctionExpression:exit'(node: TSESTree.ArrowFunctionExpression) {
        const parent = node.parent;
        if (
          !parent ||
          parent.type !== AST_NODE_TYPES.CallExpression ||
          parent.callee.type !== AST_NODE_TYPES.MemberExpression ||
          !isThenCatchFinallyMember(parent.callee)
        ) {
          return;
        }

        if (node.body.type !== AST_NODE_TYPES.CallExpression) {
          return;
        }

        const call = node.body;
        if (!isPromiseStatic(call, 'resolve') && !isPromiseStatic(call, 'reject')) {
          return;
        }

        const src = context.getSourceCode();
        const callee = call.callee as TSESTree.MemberExpression;
        const property = callee.property as TSESTree.Identifier;
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
            return fixer.replaceText(
              node,
              `${asyncPrefix}${paramsText} => { throw ${inner}; }`
            );
          }
        });
      }
    };
  }
};

export default reactionReturnsPromiseRule;
