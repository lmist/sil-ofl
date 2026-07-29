/**
 * Pure createActor unit tests for specimenMachine.
 * Run: bun test src/machines/specimen-machine.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createActor, fromPromise } from "xstate";
import { specimenMachine } from "./specimen-machine";

function createTestSpecimen(options?: {
  faceFailures?: number;
  faceErrorMessage?: string;
  metaFail?: boolean;
  metaErrorMessage?: string;
  metaMissing?: boolean;
}) {
  let remainingFaceFailures = options?.faceFailures ?? 0;
  const machine = specimenMachine.provide({
    actors: {
      loadFontFace: fromPromise(async ({ input }) => {
        if (remainingFaceFailures > 0) {
          remainingFaceFailures -= 1;
          throw new Error(options?.faceErrorMessage ?? "face fail");
        }
        return { family: input.family, sourceUrl: input.cdnUrl };
      }),
      fetchFont: fromPromise(async ({ input }) => {
        if (options?.metaFail) {
          throw new Error(options.metaErrorMessage ?? "meta fail");
        }
        if (options?.metaMissing) return null;
        return {
          id: String(input.id),
          cdnUrl: "https://cdn.example/f.woff2",
          rawUrl: "https://raw.example/f.woff2",
          format: "woff2",
          fileName: "f.woff2",
          path: "f.woff2",
          familyGuess: "Test Family",
          weightGuess: 400,
          styleGuess: "normal",
          isVariable: false,
          isWebfont: true,
          stars: 1,
          reputation: 1,
          ownerLogin: "o",
          fullName: "o/r",
          defaultBranch: "main",
          fontFileId: Number(input.id),
          repoId: 1,
          repoName: "r",
          repoUrl: "https://github.com/o/r",
          licenseSpdx: "OFL-1.1",
          ownerType: "User",
          ownerUrl: null,
        };
      }),
    },
  });
  const actor = createActor(machine, { input: {} });
  actor.start();
  return actor;
}

describe("specimenMachine", () => {
  it("starts empty", () => {
    const actor = createTestSpecimen();
    assert.equal(actor.getSnapshot().value, "empty");
  });

  it("LOAD → loadingFace → ready", async () => {
    const actor = createTestSpecimen();
    actor.send({
      type: "LOAD",
      fontId: 9,
      cdnUrl: "https://cdn.example/a.woff2",
      family: "Charis SIL",
      format: "woff2",
    });
    assert.equal(actor.getSnapshot().value, "loadingFace");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(actor.getSnapshot().value, "ready");
    assert.equal(actor.getSnapshot().context.family, "Charis SIL");
    assert.equal(
      actor.getSnapshot().context.sourceUrl,
      "https://cdn.example/a.woff2",
    );
  });

  it("LOAD preserves the resolved face weight and style", async () => {
    const actor = createTestSpecimen();
    actor.send({
      type: "LOAD",
      fontId: 10,
      cdnUrl: "https://cdn.example/italic.woff2",
      family: "Test Italic",
      format: "woff2",
      weight: 700,
      style: "italic",
    });

    await new Promise((r) => setTimeout(r, 0));
    assert.equal(actor.getSnapshot().value, "ready");
    assert.equal(actor.getSnapshot().context.weight, 700);
    assert.equal(actor.getSnapshot().context.style, "italic");
  });

  it("LOAD face error → error, RETRY recovers", async () => {
    const actor = createTestSpecimen({
      faceFailures: 1,
      faceErrorMessage:
        "FontFace.load failed: response=https://private.example/font",
    });
    actor.send({
      type: "LOAD",
      fontId: 1,
      cdnUrl: "https://cdn.example/a.woff2",
      family: "X",
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(actor.getSnapshot().value, "error");
    assert.equal(
      actor.getSnapshot().context.error,
      "Font face is unavailable.",
    );

    actor.send({ type: "RETRY" });
    assert.equal(actor.getSnapshot().value, "loadingFace");
    assert.equal(
      actor.getSnapshot().context.error,
      "Font face is unavailable.",
    );

    await new Promise((r) => setTimeout(r, 0));
    assert.equal(actor.getSnapshot().value, "ready");
    assert.equal(actor.getSnapshot().context.error, null);
  });

  it("LOAD_BY_ID fetches meta then loads face", async () => {
    const actor = createTestSpecimen();
    actor.send({ type: "LOAD_BY_ID", fontId: 55 });
    assert.equal(actor.getSnapshot().value, "loadingMeta");
    await new Promise((r) => setTimeout(r, 0));
    // meta resolved → loadingFace → ready (two promise ticks)
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(actor.getSnapshot().value, "ready");
    assert.equal(actor.getSnapshot().context.family, "Test Family");
    assert.equal(actor.getSnapshot().context.fontId, 55);
  });

  it("LOAD_BY_ID masks GraphQL request details when metadata fails", async () => {
    const internalMarker =
      "query Font($id: ID!) variables={secret} response={database}";
    const actor = createTestSpecimen({
      metaFail: true,
      metaErrorMessage: internalMarker,
    });

    actor.send({ type: "LOAD_BY_ID", fontId: 55 });
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(actor.getSnapshot().value, "error");
    assert.equal(
      actor.getSnapshot().context.error,
      "Font details are unavailable.",
    );
    assert.doesNotMatch(
      actor.getSnapshot().context.error ?? "",
      /query|secret|database/,
    );
  });

  it("LOAD_BY_ID missing font → error", async () => {
    const actor = createTestSpecimen({ metaMissing: true });
    actor.send({ type: "LOAD_BY_ID", fontId: 404 });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(actor.getSnapshot().value, "error");
    assert.equal(actor.getSnapshot().context.error, "Font not found");
  });

  it("ignores a late face completion after a newer selection supersedes it", async () => {
    const complete = new Map<
      string,
      (output: { family: string; sourceUrl: string }) => void
    >();
    const machine = specimenMachine.provide({
      actors: {
        loadFontFace: fromPromise(
          ({ input }) =>
            new Promise((resolve) => {
              complete.set(input.family, resolve);
            }),
        ),
      },
    });
    const actor = createActor(machine, { input: {} });
    actor.start();

    actor.send({
      type: "LOAD",
      fontId: 1,
      cdnUrl: "https://cdn.example/a.woff2",
      family: "First Family",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    actor.send({
      type: "LOAD",
      fontId: 2,
      cdnUrl: "https://cdn.example/b.woff2",
      family: "Second Family",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    complete.get("First Family")?.({
      family: "First Family",
      sourceUrl: "https://cdn.example/a.woff2",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(actor.getSnapshot().value, "loadingFace");
    assert.equal(actor.getSnapshot().context.fontId, 2);
    assert.equal(actor.getSnapshot().context.family, "Second Family");
    assert.equal(actor.getSnapshot().context.sourceUrl, null);

    complete.get("Second Family")?.({
      family: "Second Family",
      sourceUrl: "https://cdn.example/b.woff2",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(actor.getSnapshot().value, "ready");
    assert.equal(actor.getSnapshot().context.fontId, 2);
    assert.equal(actor.getSnapshot().context.family, "Second Family");
    assert.equal(
      actor.getSnapshot().context.sourceUrl,
      "https://cdn.example/b.woff2",
    );
  });

  it("CLEAR returns to empty", async () => {
    const actor = createTestSpecimen();
    actor.send({
      type: "LOAD",
      fontId: 1,
      cdnUrl: "https://cdn.example/a.woff2",
      family: "X",
    });
    await new Promise((r) => setTimeout(r, 0));
    actor.send({ type: "CLEAR" });
    assert.equal(actor.getSnapshot().value, "empty");
    assert.equal(actor.getSnapshot().context.fontId, null);
  });
});
