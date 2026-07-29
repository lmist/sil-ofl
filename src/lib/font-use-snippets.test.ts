import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
});
