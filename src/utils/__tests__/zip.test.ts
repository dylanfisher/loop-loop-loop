import { describe, expect, it } from "vitest";
import { createZipBuffer, readZip } from "../zip";

describe("zip utils", () => {
  it("roundtrips stored entries", async () => {
    const encoder = new TextEncoder();
    const files = [
      { path: "session.json", data: encoder.encode("{\"ok\":true}") },
      { path: "audio/deck-1.wav", data: encoder.encode("wave") },
    ];

    const buffer = createZipBuffer(files).buffer;
    const entries = readZip(buffer);

    expect(entries.size).toBe(2);
    expect(new TextDecoder().decode(entries.get("session.json")!)).toBe("{\"ok\":true}");
    expect(new TextDecoder().decode(entries.get("audio/deck-1.wav")!)).toBe("wave");
  });
});
