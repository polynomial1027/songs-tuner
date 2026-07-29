import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "./download";

describe("downloadBlob", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("attaches, clicks, removes, and later revokes the download URL", () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const revokeObjectURL = vi.fn();
    const anchor = { href: "", download: "", style: { display: "" }, click, remove };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => anchor),
      body: { appendChild },
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:singright-download"),
      revokeObjectURL,
    });

    downloadBlob(new Blob(["score"]), "my-song.singright.json");

    expect(anchor.href).toBe("blob:singright-download");
    expect(anchor.download).toBe("my-song.singright.json");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:singright-download");
  });
});
