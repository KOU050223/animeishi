/**
 * ESLint カスタムルール: no-direct-db
 *
 * services/api/src/repository/ 以外のファイルから
 * createDb() の戻り値を直接操作すること（.insert/.update/.delete）を禁止する。
 * 必ず authorizedDb（リポジトリ層）を経由してDB操作を行うこと。
 *
 * エイリアス追跡: `const x = db` や `x = db` のように別名を経由した場合も検出する。
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
    // OS依存のパス区切り文字を正規化
    const normalizedFilename = filename.replace(/\\/g, "/");

    // リポジトリ層自体は許可
    if (normalizedFilename.includes("/repository/")) {
      return {};
    }

    const FORBIDDEN_METHODS = ["insert", "update", "delete"];

    // createDb() 由来の識別子（およびそのエイリアス）を追跡する Set
    const dbIdentifiers = new Set();

    /**
     * 識別子が dbIdentifiers に含まれているかを確認する。
     * MemberExpression の最上位オブジェクトも再帰的に確認する。
     */
    function isDbIdentifier(node) {
      if (node.type === "Identifier") {
        return dbIdentifiers.has(node.name);
      }
      if (node.type === "MemberExpression") {
        return isDbIdentifier(node.object);
      }
      return false;
    }

    return {
      // `const db = createDb(...)` を検出し dbIdentifiers に登録
      VariableDeclarator(node) {
        if (!node.id || node.id.type !== "Identifier") return;
        if (!node.init) return;

        // createDb() 直接呼び出し
        if (
          node.init.type === "CallExpression" &&
          node.init.callee.type === "Identifier" &&
          node.init.callee.name === "createDb"
        ) {
          dbIdentifiers.add(node.id.name);
          return;
        }

        // `const x = db` のようなエイリアス
        if (
          node.init.type === "Identifier" &&
          dbIdentifiers.has(node.init.name)
        ) {
          dbIdentifiers.add(node.id.name);
        }
      },

      // `x = db` のような代入によるエイリアスも追跡
      AssignmentExpression(node) {
        if (
          node.left.type === "Identifier" &&
          node.right.type === "Identifier" &&
          dbIdentifiers.has(node.right.name)
        ) {
          dbIdentifiers.add(node.left.name);
        }
      },

      // db.insert() / db.update() / db.delete() を検出
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier" &&
          FORBIDDEN_METHODS.includes(node.callee.property.name) &&
          isDbIdentifier(node.callee.object)
        ) {
          context.report({
            node,
            messageId: "noDirectDb",
          });
        }
      },
    };
  },
};
