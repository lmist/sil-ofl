import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
    assert.match(s.css, /@font-face/);
    assert.match(s.css, /Apfel Grotezk/);
    assert.match(s.css, /cdn\.jsdelivr\.net/);
    assert.match(s.css, /format\('opentype'\)/);
    assert.match(s.html, /<!doctype html>/i);
    assert.equal(s.repoUrl, sample.repoUrl);
  });

  it("builds a syntactically valid React example for the selected face", () => {
    const s = buildFontUseSnippets(sample);
    const result = ts.transpileModule(s.react, {
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
    assert.doesNotMatch(s.react, /^\s*\/\//m);
    assert.match(s.react, /export function FontExample/);
    assert.match(s.react, /Apfel Grotezk/);
    assert.match(s.react, /cdn\.jsdelivr\.net/);
    assert.match(s.react, /fontWeight: 400/);
    assert.match(s.react, /fontStyle: "normal"/);
  });

  it("applies a weighted italic face in every copied usage example", () => {
    const s = buildFontUseSnippets({
      ...sample,
      fileName: "ApfelGrotezk-BoldItalic.otf",
      weightGuess: 700,
      styleGuess: "italic",
    });

    assert.match(
      s.css,
      /\.my-text \{\n  font-family: 'Apfel Grotezk', system-ui, sans-serif;\n  font-weight: 700;\n  font-style: italic;\n\}/,
    );
    assert.match(
      s.html,
      /body \{\n      font-family: 'Apfel Grotezk', system-ui, sans-serif;\n      font-weight: 700;\n      font-style: italic;/,
    );
    assert.match(s.react, /fontWeight: 700/);
    assert.match(s.react, /fontStyle: "italic"/);
  });
});
