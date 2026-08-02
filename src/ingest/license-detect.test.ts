/**
 * license-detect.test.ts
 *
 * Pure, offline tests for OFL licence text detection.
 * No network, no database, no real files fetched.
 *
 * Coverage:
 *   - Real OFL 1.1 full text → detects OFL-1.1 with high confidence
 *   - Real OFL 1.0 full text → detects OFL-1.0 with high confidence
 *   - Apache 2.0 header → returns null
 *   - MIT licence → returns null
 *   - OFL fragment too short → returns null (< 500 chars threshold)
 *   - Prose mentioning OFL without the licence body → returns null
 *   - Empty string → returns null
 *   - candidateLicencePaths() returns expected paths
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectOflFromText, candidateLicencePaths } from "./license-detect.js";

// ---------------------------------------------------------------------------
// Real OFL 1.1 text (verbatim excerpt, sufficient for detection)
// Source: https://openfontlicense.org/documents/OFL.txt
// ---------------------------------------------------------------------------
const OFL_11_TEXT = `
This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
`.trim();

// ---------------------------------------------------------------------------
// Real OFL 1.0 text (verbatim excerpt, sufficient for detection)
// Source: chrullrich/freebsd-ports-public Templates/Licenses/OFL10
// (official OFL 1.0 — 22 November 2005)
// ---------------------------------------------------------------------------
const OFL_10_TEXT = `
This Font Software is licensed under the SIL Open Font License, Version 1.0.
No modification of the license is permitted, only verbatim copy is allowed.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.0 - 22 November 2005
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of cooperative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide an open
framework in which fonts may be shared and improved in partnership with
others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and sold with any software provided that the font
names of derivative works are changed. The fonts and derivatives,
however, cannot be released under any other type of license.

DEFINITIONS
"Font Software" refers to any and all of the following:
  - font files
  - data files
  - source code
  - build scripts
  - documentation

"Reserved Font Name" refers to the Font Software name as seen by
users and any other names as specified after the copyright statement.

"Standard Version" refers to the collection of Font Software
components as distributed by the Copyright Holder.

"Modified Version" refers to any derivative font software made by
adding to, deleting, or substituting -- in part or in whole --
any of the components of the Standard Version, by changing formats
or by porting the Font Software to a new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Standard or Modified Versions, may be sold by itself.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
`.trim();

// ---------------------------------------------------------------------------
// Apache 2.0 header (clearly not OFL)
// ---------------------------------------------------------------------------
const APACHE_TEXT = `
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
`.trim();

// ---------------------------------------------------------------------------
// MIT licence
// ---------------------------------------------------------------------------
const MIT_TEXT = `
MIT License

Copyright (c) 2024 Some Author

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`.trim();

// ---------------------------------------------------------------------------
// OFL fragment — too short to be conclusive (under 500 chars)
// ---------------------------------------------------------------------------
const OFL_FRAGMENT = `
SIL Open Font License, Version 1.1.
This font is licensed under the OFL.
Permission & Conditions apply.
`.trim();

// ---------------------------------------------------------------------------
// Prose mention — mentions OFL but is not the licence body itself
// ---------------------------------------------------------------------------
const OFL_PROSE_MENTION = `
This typeface is distributed with several open-source licences available.
The main font files are available under the SIL Open Font License (OFL),
a widely-used licence for fonts. The SIL Open Font License allows users
to use, study, modify, and redistribute the fonts. For details, see the
OFL text at https://openfontlicense.org. Some auxiliary files may be
released under other terms. This README is provided for informational
purposes only and does not constitute legal advice. Please consult the
actual licence files in the repository for authoritative terms. The
presence of OFL-licensed fonts in this repository does not imply that
all files are under the OFL. Check each file's header for its specific
licence terms before using it in a project.
`.trim();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("detectOflFromText", () => {
  it("detects OFL-1.1 from real licence text", () => {
    const result = detectOflFromText(OFL_11_TEXT);
    assert.ok(result !== null, "should detect OFL from real 1.1 text");
    assert.equal(result!.spdx, "OFL-1.1");
    assert.equal(result!.confidence, "high");
    assert.ok(result!.matchedOn.length >= 2, "should have at least 2 matched signals");
  });

  it("detects OFL-1.0 from real licence text", () => {
    const result = detectOflFromText(OFL_10_TEXT);
    assert.ok(result !== null, "should detect OFL from real 1.0 text");
    assert.equal(result!.spdx, "OFL-1.0");
    assert.equal(result!.confidence, "high");
    assert.ok(result!.matchedOn.length >= 2, "should have at least 2 matched signals");
  });

  it("distinguishes OFL-1.0 from OFL-1.1 (no cross-match)", () => {
    const r10 = detectOflFromText(OFL_10_TEXT);
    const r11 = detectOflFromText(OFL_11_TEXT);
    assert.equal(r10?.spdx, "OFL-1.0");
    assert.equal(r11?.spdx, "OFL-1.1");
    assert.notEqual(r10?.spdx, r11?.spdx);
  });

  it("returns null for an Apache 2.0 licence", () => {
    assert.equal(detectOflFromText(APACHE_TEXT), null);
  });

  it("returns null for an MIT licence", () => {
    assert.equal(detectOflFromText(MIT_TEXT), null);
  });

  it("returns null for an OFL fragment too short to be conclusive (< 500 chars)", () => {
    assert.ok(OFL_FRAGMENT.length < 500, `fragment length is ${OFL_FRAGMENT.length}`);
    assert.equal(detectOflFromText(OFL_FRAGMENT), null);
  });

  it("returns null for prose that mentions OFL without containing the licence body", () => {
    // The prose is > 500 chars but lacks the required version-specific signals
    assert.ok(OFL_PROSE_MENTION.length >= 500, "prose should be long enough to pass length gate");
    assert.equal(detectOflFromText(OFL_PROSE_MENTION), null);
  });

  it("returns null for an empty string", () => {
    assert.equal(detectOflFromText(""), null);
  });

  it("returns null for a whitespace-only string", () => {
    assert.equal(detectOflFromText("   \n\n   "), null);
  });

  it("returns null for a string shorter than 500 chars", () => {
    assert.equal(detectOflFromText("SIL Open Font License Version 1.1"), null);
  });

  it("matchedOn array contains the signals that triggered the match", () => {
    const result = detectOflFromText(OFL_11_TEXT);
    assert.ok(result !== null);
    assert.ok(Array.isArray(result!.matchedOn));
    assert.ok(result!.matchedOn.every((s) => typeof s === "string"));
    // The version title line should be one of the matched signals
    assert.ok(
      result!.matchedOn.some((s) => s.includes("1.1")),
      `expected a 1.1 signal in matchedOn, got: ${JSON.stringify(result!.matchedOn)}`
    );
  });

  it("is case-insensitive (uppercased OFL text still matches)", () => {
    const upper = OFL_11_TEXT.toUpperCase();
    const result = detectOflFromText(upper);
    assert.ok(result !== null, "should match after uppercasing");
    assert.equal(result!.spdx, "OFL-1.1");
  });
});

describe("candidateLicencePaths", () => {
  it("returns a non-empty array", () => {
    const paths = candidateLicencePaths();
    assert.ok(Array.isArray(paths));
    assert.ok(paths.length > 0);
  });

  it("includes OFL.txt", () => {
    assert.ok(candidateLicencePaths().includes("OFL.txt"));
  });

  it("includes LICENSE and LICENCE variants", () => {
    const paths = candidateLicencePaths();
    assert.ok(paths.includes("LICENSE"));
    assert.ok(paths.includes("LICENCE"));
  });

  it("includes fonts/ subdirectory variants", () => {
    const paths = candidateLicencePaths();
    assert.ok(paths.some((p) => p.startsWith("fonts/")));
  });

  it("returns the same array on repeated calls (stable)", () => {
    const a = candidateLicencePaths();
    const b = candidateLicencePaths();
    assert.deepEqual([...a], [...b]);
  });
});
