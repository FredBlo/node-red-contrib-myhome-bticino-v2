const js = require("@eslint/js");
const globals = require("globals");
const html = require("eslint-plugin-html");
const prettier = require("eslint-config-prettier");

module.exports = [
  // Base recommended rules
  js.configs.recommended,

  // Runtime JS files (server-side code that runs in Node-RED)
  {
    files: ["**/*.js"],
    ignores: ["node_modules/**", "dist/**"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node
      }
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off", // Node-RED often uses node.log/node.warn, but console is still common in dev
      "no-empty": ["error", { "allowEmptyCatch": true }] // allows try catch blocks without any code in the catch block
    }
  },

  // HTML files (embedded client-side JS: RED.nodes.registerType, etc.)
  {
    files: ["**/*.html"],
    plugins: { html },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        RED: "readonly",
        $: "readonly",
        jQuery: "readonly"
      }
    },
    rules: {
      "no-unused-vars": "warn"
    }
  },

  // Disable anything that could conflict with Prettier — ALWAYS LAST
  prettier
];