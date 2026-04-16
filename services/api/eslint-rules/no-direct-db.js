/**
 * ESLint カスタムルール: no-direct-db
 *
 * services/api/src/repository/ 以外のファイルから
 * createDb() の戻り値を直接操作すること（.insert/.update/.delete）を禁止する。
 * 必ず authorizedDb（リポジトリ層）を経由してDB操作を行うこと。
 *
 * エイリアス追跡:
 *   - `const db = createDb(...)` / `db = createDb(...)` で登録
 *   - `const x = db` / `x = db` のようなエイリアスも追跡
 * ブラケット記法:
 *   - `db["insert"](...)` などのリテラル文字列によるアクセスも検出
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
    // OS依存のパス区切り文字を正規化（Windows 対応）
    const normalizedFilename = filename.replace(/\\/g, "/");

    // リポジトリ層自体は許可
    if (normalizedFilename.includes("/repository/")) {
      return {};
    }

    const FORBIDDEN_METHODS = ["insert", "update", "delete"];

    // createDb() 由来の識別子（およびそのエイリアス）を追跡する Set
    const dbIdentifiers = new Set();

    /**
     * MemberExpression のプロパティ名を取得する。
     * - ドット記法: `db.insert` → "insert"
     * - ブラケット記法（文字列リテラル）: `db["insert"]` → "insert"
     * - ブラケット記法（変数）: `db[method]` → null（追跡不可）
     */
    function getPropertyName(memberExpression) {
      if (
        memberExpression.property.type === "Identifier" &&
        !memberExpression.computed
      ) {
        return memberExpression.property.name;
      }
      if (
        memberExpression.computed &&
        memberExpression.property.type === "Literal" &&
        typeof memberExpression.property.value === "string"
      ) {
        return memberExpression.property.value;
      }
      return null;
    }

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

      // `x = db` および `x = createDb(...)` のような代入も追跡
      AssignmentExpression(node) {
        if (node.left.type !== "Identifier") return;

        // `db = createDb(...)` パターン
        if (
          node.right.type === "CallExpression" &&
          node.right.callee.type === "Identifier" &&
          node.right.callee.name === "createDb"
        ) {
          dbIdentifiers.add(node.left.name);
          return;
        }

        // `x = db` のようなエイリアス
        if (
          node.right.type === "Identifier" &&
          dbIdentifiers.has(node.right.name)
        ) {
          dbIdentifiers.add(node.left.name);
        }
      },

      // db.insert() / db["insert"]() / db.update() / db.delete() を検出
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") return;

        const propertyName = getPropertyName(node.callee);
        if (
          propertyName &&
          FORBIDDEN_METHODS.includes(propertyName) &&
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
