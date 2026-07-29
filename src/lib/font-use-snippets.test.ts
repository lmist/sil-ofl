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

function available(value: string | null): string {
  assert.ok(value);
  return value;
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
});
