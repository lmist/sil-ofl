import { describe, it } from "node:test";
import assert from "node:assert/strict";
import postcss from "postcss";
import ts from "typescript";
import {
  buildFontUseSnippets,
  cssFormatHint,
  familyName,
} from "./font-use-snippets";
import type { FontFile } from "@/types/catalog";

const sample: FontFile = {
  fontFileId: 1,
  cdnUrl:
    "https://cdn.jsdelivr.net/gh/collletttivo/apfel-grotezk@main/fonts/ApfelGrotezk-Regular.otf",
  rawUrl:
    "https://raw.githubusercontent.com/collletttivo/apfel-grotezk/main/fonts/ApfelGrotezk-Regular.otf",
  format: "otf",
  fileName: "ApfelGrotezk-Regular.otf",
  path: "fonts/ApfelGrotezk-Regular.otf",
  familyGuess: "Apfel Grotezk",
  weightGuess: 400,
  styleGuess: "normal",
  isVariable: false,
  isWebfont: false,
  repoId: 1,
  fullName: "collletttivo/apfel-grotezk",
  repoName: "apfel-grotezk",
  repoUrl: "https://github.com/collletttivo/apfel-grotezk",
  stars: 100,
  reputation: 100,
  licenseSpdx: "OFL-1.1",
  defaultBranch: "main",
  ownerLogin: "collletttivo",
  ownerType: "Organization",
  ownerUrl: "https://github.com/collletttivo",
};

function available(value: string | null): string {
  assert.ok(value);
  return value;
}

function parseReactArtifact(source: string): {
  embeddedCss: string;
  inlineFamily: string;
} {
  const result = ts.transpileModule(source, {
    fileName: "font-example.tsx",
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const syntaxErrors = (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    );
  assert.deepEqual(syntaxErrors, []);

  const sourceFile = ts.createSourceFile(
    "font-example.tsx",
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );
  let embeddedCss: string | null = null;
  let inlineFamily: string | null = null;

  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(sourceFile) === "style"
    ) {
      const expression = node.children.find(ts.isJsxExpression)?.expression;
      if (expression && ts.isStringLiteral(expression)) {
        embeddedCss = expression.text;
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(sourceFile) === "fontFamily" &&
      ts.isStringLiteral(node.initializer)
    ) {
      inlineFamily = node.initializer.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  assert.ok(embeddedCss);
  assert.ok(inlineFamily);
  return { embeddedCss, inlineFamily };
}

describe("font-use-snippets", () => {
  it("maps formats", () => {
    assert.equal(cssFormatHint("woff2"), "woff2");
    assert.equal(cssFormatHint("otf"), "opentype");
    assert.equal(cssFormatHint("ttf"), "truetype");
  });

  it("prefers familyGuess", () => {
    assert.equal(familyName(sample), "Apfel Grotezk");
  });

  it("builds pasteable css with cdn url", () => {
    const s = buildFontUseSnippets(sample);
    const css = available(s.css);
    assert.match(css, /@font-face/);
    assert.match(css, /Apfel Grotezk/);
    assert.match(css, /cdn\.jsdelivr\.net/);
    assert.match(css, /format\('opentype'\)/);
    assert.match(available(s.html), /<!doctype html>/i);
    assert.equal(s.repoUrl, sample.repoUrl);
  });

  it("builds a syntactically valid React example for the selected face", () => {
    const s = buildFontUseSnippets(sample);
    const react = available(s.react);
    const result = ts.transpileModule(react, {
      fileName: "font-example.tsx",
      reportDiagnostics: true,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    });
    const syntaxErrors = (result.diagnostics ?? [])
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      );

    assert.deepEqual(syntaxErrors, []);
    assert.doesNotMatch(react, /^\s*\/\//m);
    assert.match(react, /export function FontExample/);
    assert.match(react, /Apfel Grotezk/);
    assert.match(react, /cdn\.jsdelivr\.net/);
    assert.match(react, /fontWeight: 400/);
    assert.match(react, /fontStyle: "normal"/);
  });

  it("quotes a selected generic-looking family in the React fallback list", () => {
    for (const family of ["serif", "inherit"]) {
      const s = buildFontUseSnippets({
        ...sample,
        familyGuess: family,
      });

      assert.equal(
        parseReactArtifact(available(s.react)).inlineFamily,
        `'${family}', system-ui, sans-serif`,
      );
    }
  });

  it("applies a weighted italic face in every copied usage example", () => {
    const s = buildFontUseSnippets({
      ...sample,
      fileName: "ApfelGrotezk-BoldItalic.otf",
      weightGuess: 700,
      styleGuess: "italic",
    });

    assert.match(
      available(s.css),
      /\.my-text \{\n  font-family: 'Apfel Grotezk', system-ui, sans-serif;\n  font-weight: 700;\n  font-style: italic;\n\}/,
    );
    assert.match(
      available(s.html),
      /body \{\n      font-family: 'Apfel Grotezk', system-ui, sans-serif;\n      font-weight: 700;\n      font-style: italic;/,
    );
    const react = available(s.react);
    assert.match(react, /fontWeight: 700/);
    assert.match(react, /fontStyle: "italic"/);
  });

  it("keeps invalid weights out of every generated artifact", () => {
    for (const invalidWeight of [0.5, 400.5, 1000.1, 1001]) {
      const s = buildFontUseSnippets({
        ...sample,
        weightGuess: invalidWeight,
      });
      const css = available(s.css);
      const html = available(s.html);
      const react = available(s.react);

      assert.equal(s.weight, 400);
      assert.equal(css.match(/font-weight: 400;/g)?.length, 2);
      assert.equal(html.match(/font-weight: 400;/g)?.length, 2);
      assert.match(react, /font-weight: 400;/);
      assert.match(react, /fontWeight: 400/);
      for (const artifact of [css, html, react]) {
        assert.doesNotMatch(
          artifact,
          new RegExp(`(?:font-weight:|fontWeight:) ${invalidWeight}`),
        );
      }
    }
  });

  it("does not expose unapproved font or repository targets", () => {
    const s = buildFontUseSnippets({
      ...sample,
      cdnUrl: "https://fonts.evil.example/face.otf",
      rawUrl: "http://raw.githubusercontent.com/example/fonts/main/face.otf",
      repoUrl: "javascript:alert(document.domain)",
    });

    assert.equal(s.css, null);
    assert.equal(s.html, null);
    assert.equal(s.react, null);
    assert.equal(s.cdnUrl, null);
    assert.equal(s.rawUrl, null);
    assert.equal(s.repoUrl, null);
    assert.equal(s.downloadUrl, null);
    assert.equal(
      s.policyError,
      "Some font actions are unavailable because this record has unapproved links.",
    );
    assert.doesNotMatch(
      JSON.stringify(s),
      /fonts\.evil\.example|javascript:|http:\/\/raw\.githubusercontent\.com/,
    );
  });

  it("keeps an approved URL inert inside every generated CSS string", () => {
    const hostileUrl =
      "https://cdn.jsdelivr.net/x');font-style:oblique;/*";
    const s = buildFontUseSnippets({
      ...sample,
      cdnUrl: hostileUrl,
    });
    const htmlStyle = available(s.html).match(
      /<style>\n([\s\S]*?)\n  <\/style>/,
    )?.[1];
    const artifacts = [
      available(s.css),
      available(htmlStyle ?? null),
      parseReactArtifact(available(s.react)).embeddedCss,
    ];

    for (const artifact of artifacts) {
      const root = postcss.parse(artifact);
      const injectedStyles: string[] = [];
      root.walkDecls("font-style", (declaration) => {
        if (declaration.value === "oblique") {
          injectedStyles.push(declaration.toString());
        }
      });
      assert.deepEqual(injectedStyles, []);
    }
    assert.equal(s.cdnUrl, hostileUrl);
    assert.equal(s.downloadUrl, hostileUrl);
  });

  it("target-escapes hostile metadata without changing the family identity", () => {
    const family = "O'Brien </title><script>alert(1)</script>\n\\face";
    const s = buildFontUseSnippets({
      ...sample,
      familyGuess: family,
      fullName: "o/r */ body{display:none} /*",
    });
    const css = available(s.css);
    const cssRoot = postcss.parse(css);
    const injectedBody = cssRoot.nodes.find(
      (node) => node.type === "rule" && node.selector === "body",
    );
    const react = parseReactArtifact(available(s.react));

    postcss.parse(react.embeddedCss);
    assert.equal(injectedBody?.toString(), undefined);
    assert.equal(s.family, family);
    assert.equal(
      react.inlineFamily,
      `${s.familyCss}, system-ui, sans-serif`,
    );
    assert.match(
      available(s.html),
      /<title>O'Brien &lt;\/title&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;\n\\face<\/title>/,
    );
  });
});
