module.exports = {
  // Add semicolons at the end of statements (matches typical Node-RED codebase style)
  semi: true,

  // Use double quotes (Node-RED core and most contrib nodes use double quotes)
  singleQuote: false,

  // 2-space indentation (standard across Node-RED core and the ecosystem)
  tabWidth: 2,

  // No tabs, spaces only
  useTabs: false,

  // Trailing commas where valid in ES5 (objects, arrays) - safe default, avoids noisy diffs
  trailingComma: "es5",

  // Print width before wrapping lines
  printWidth: 100,

  // Add spaces inside object braces: { foo: bar } instead of {foo: bar}
  bracketSpacing: true,

  // Put the > of a multi-line JSX/HTML element on the same line as the last attribute
  bracketSameLine: false,

  // Always wrap arrow function params in parens: (x) => x instead of x => x
  arrowParens: "always",

  // Use line feed only (avoids CRLF/LF conflicts if the team is on mixed OS)
  endOfLine: "lf"
};