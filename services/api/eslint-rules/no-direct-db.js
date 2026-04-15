/**
 * ESLint カスタムルール: no-direct-db
 *
 * services/api/src/repository/ 以外のファイルから
 * createDb() の戻り値を直接操作すること（.insert/.update/.delete）を禁止する。
 * 必ず authorizedDb（リポジトリ層）を経由してDB操作を行うこと。
 */

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "リポジトリ層（authorizedDb）を経由せず直接DBを操作することを禁止します",
      category: "Best Practices",
      recommended: true,
    },
    messages: {
      noDirectDb:
        "直接DBを操作することは禁止されています。authorizedDb（リポジトリ層）を経由してください。",
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();

    // リポジトリ層自体は許可
    if (filename.includes("/repository/")) {
      return {};
    }

    const FORBIDDEN_METHODS = ["insert", "update", "delete"];

    return {
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          node.callee.property.type === "Identifier" &&
          FORBIDDEN_METHODS.includes(node.callee.property.name)
        ) {
          const objectName = node.callee.object.name;
          // drizzle インスタンスらしい変数名のパターン
          if (/^(db|drizzleDb|d1|database)$/.test(objectName)) {
            context.report({
              node,
              messageId: "noDirectDb",
            });
          }
        }
      },
    };
  },
};
