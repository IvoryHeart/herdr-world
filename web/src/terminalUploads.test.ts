import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadWithOverwritePrompt } from "./terminalUploads";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadWithOverwritePrompt", () => {
  it("requests atomic conflict renaming when the setting is enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(uploadResponse("image-1.png"));
    const confirmReplace = vi.fn();

    const uploaded = await uploadWithOverwritePrompt(
      testHttpUrl,
      fetchMock,
      admitted,
      imageFile(),
      true,
      confirmReplace,
    );

    expect(uploaded.name).toBe("image-1.png");
    expect(requestQuery(fetchMock)).toEqual({
      name: "image.png",
      rename_conflicts: "true",
    });
    expect(confirmReplace).not.toHaveBeenCalled();
  });

  it("keeps the Replace or Cancel prompt when automatic renaming is disabled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(conflictResponse("image.png"))
      .mockResolvedValueOnce(uploadResponse("image.png"));
    const confirmReplace = vi.fn().mockResolvedValue(true);

    await uploadWithOverwritePrompt(testHttpUrl, fetchMock, admitted, imageFile(), false, confirmReplace);

    expect(confirmReplace).toHaveBeenCalledOnce();
    expect(requestQuery(fetchMock, 0)).toEqual({ name: "image.png" });
    expect(requestQuery(fetchMock, 1)).toEqual({ name: "image.png", overwrite: "true" });
  });

  it("does not offer replacement when automatic suffixes are exhausted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "no available filename for image.png" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    const confirmReplace = vi.fn();

    await expect(
      uploadWithOverwritePrompt(testHttpUrl, fetchMock, admitted, imageFile(), true, confirmReplace),
    ).rejects.toThrow("no available filename for image.png");
    expect(confirmReplace).not.toHaveBeenCalled();
  });

  it("uses the supplied authenticated fetcher and rechecks admission before overwrite", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(conflictResponse("image.png"))
      .mockResolvedValueOnce(uploadResponse("image.png"));
    const isAdmitted = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const confirmReplace = vi.fn().mockResolvedValue(true);

    await expect(
      uploadWithOverwritePrompt(testHttpUrl, fetchMock, isAdmitted, imageFile(), false, confirmReplace),
    ).rejects.toThrow("Upload is no longer available for this terminal");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(isAdmitted).toHaveBeenCalledTimes(2);
  });
});

const admitted = () => true;

function imageFile() {
  return {
    blob: new Blob(["image"], { type: "image/png" }),
    name: "image.png",
  };
}

function testHttpUrl(path: string, query?: URLSearchParams) {
  const suffix = query && query.size > 0 ? `?${query}` : "";
  return `http://bridge.test${path}${suffix}`;
}

function uploadResponse(name: string) {
  return new Response(
    JSON.stringify({
      file: {
        name,
        path: `/uploads/${name}`,
        size: 5,
        mime: "image/png",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function conflictResponse(name: string) {
  return new Response(
    JSON.stringify({ error: "file exists", name, path: `/uploads/${name}` }),
    { status: 409, headers: { "content-type": "application/json" } },
  );
}

function requestQuery(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const url = new URL(String(fetchMock.mock.calls[call]?.[0]));
  return Object.fromEntries(url.searchParams.entries());
}
