import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { emptyMistakeHistory, mistakeReducer } from "../../lib/review/mistakes.mjs";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { transform, loadBindings } = require("next/dist/build/swc");
await loadBindings();
const filename = fileURLToPath(new URL("./MistakeNotifications.jsx", import.meta.url));
const { code } = await transform(readFileSync(filename, "utf8"), {
  filename, jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022", transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
});
const compiled = { exports: {} };
const localRequire = (id) => require(id.startsWith("@/") ? fileURLToPath(new URL(`../../${id.slice(2)}`, import.meta.url)) : id);
new Function("require", "module", "exports", code)(localRequire, compiled, compiled.exports);
const { default: Notifications, MistakeWarnings } = compiled.exports;
const entry = { id: "one", recognized: "末", alternatives: ["未"], priority: "low", evidence: "first", status: "active", live: true, bounds: null };
const history = { ...emptyMistakeHistory(), occurrences: [entry] };
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test("low-priority unlocated mistakes have accessible buttons and no warning", () => {
  const html = render(Notifications, { history, onNavigate() {} });
  assert.match(html, /Low priority/); assert.match(html, /Location unavailable/);
  assert.match(html, /<button type="button" aria-pressed="false"/);
  assert.equal(render(MistakeWarnings, { history }), "");
});

test("promotion updates one notification, shared navigation opens it, and dismissal suppresses warning", () => {
  const promoted = { ...history, occurrences: [{ ...entry, priority: "high", evidence: "confirmed" }] };
  const navigated = []; const dismissed = [];
  const warningTree = MistakeWarnings({ history: promoted, onNavigate: (value) => navigated.push(value.id), onDismiss: (ids) => dismissed.push(ids) });
  const html = render(Notifications, { history: promoted, selectedId: "one" });
  assert.equal((html.match(/High priority/g) ?? []).length, 1);
  assert.match(html, /aria-pressed="true"/);
  warningTree.props.children[1].props.children[0].props.children.props.onClick();
  warningTree.props.children[0].props.children[1].props.onClick();
  assert.deepEqual(navigated, ["one"]); assert.deepEqual(dismissed, [["one"]]);
  const acknowledged = mistakeReducer(promoted, { type: "acknowledge", ids: dismissed[0] });
  assert.equal(render(MistakeWarnings, { history: acknowledged }), "");
});

test("resolved and removed entries remain in session history with their confirmed correction", () => {
  const archived = { ...history, occurrences: [{ ...entry, status: "removed" }], confirmations: [{ occurrenceId: "one", intended: "未" }] };
  const html = render(Notifications, { history: archived });
  assert.match(html, /Session history \(1\)/); assert.match(html, /Earlier writing removed/);
  assert.match(html, /User confirmed/); assert.match(html, /未/);
  assert.equal(render(MistakeWarnings, { history: archived }), "");
});
