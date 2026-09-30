import { expect, test } from "bun:test";
import { parseSource, plainUrl, sourceKey } from "./sources.ts";
import { vimeoEmbedUrl } from "./providers/vimeo.ts";

test("vimeo links in every common shape", () => {
  expect(parseSource("https://vimeo.com/1226915932")).toEqual({ provider: "vimeo", id: "1226915932" });
  expect(parseSource("vimeo.com/1226915932/ab12cd34ef")).toEqual({ provider: "vimeo", id: "1226915932", hash: "ab12cd34ef" });
  expect(parseSource("https://player.vimeo.com/video/1226915932?h=ab12cd&dnt=1")).toEqual({
    provider: "vimeo",
    id: "1226915932",
    hash: "ab12cd",
  });
  expect(parseSource("https://vimeo.com/channels/staffpicks/123456")).toEqual({ provider: "vimeo", id: "123456" });
  expect(parseSource("1226915932")).toEqual({ provider: "vimeo", id: "1226915932" });
});

test("youtube links in every common shape", () => {
  const yt = { provider: "youtube", id: "dQw4w9WgXcQ" };
  expect(parseSource("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s")).toEqual(yt);
  expect(parseSource("https://youtu.be/dQw4w9WgXcQ?si=abc")).toEqual(yt);
  expect(parseSource("youtube.com/embed/dQw4w9WgXcQ")).toEqual(yt);
  expect(parseSource("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toEqual(yt);
  expect(parseSource("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toEqual(yt);
  expect(parseSource("https://www.youtube.com/live/dQw4w9WgXcQ")).toEqual(yt);
  expect(parseSource("https://www.youtube.com/watch?v=short")).toBeNull();
  expect(parseSource("https://www.youtube.com/@channel")).toBeNull();
});

test("loom share and embed links", () => {
  const id = "0123456789abcdef0123456789abcdef";
  expect(parseSource(`https://www.loom.com/share/${id}?sid=x`)).toEqual({ provider: "loom", id });
  expect(parseSource(`https://www.loom.com/embed/${id}`)).toEqual({ provider: "loom", id });
  expect(parseSource("https://www.loom.com/looms/videos")).toBeNull();
});

test("video files and HLS, absolute or site-relative", () => {
  expect(parseSource("https://cdn.example.com/vsl/final.mp4")).toEqual({ provider: "file", id: "https://cdn.example.com/vsl/final.mp4" });
  expect(parseSource("https://vz-1.b-cdn.net/abc/playlist.m3u8")?.provider).toBe("file");
  expect(parseSource("/video/hero.webm?v=2")).toEqual({ provider: "file", id: "/video/hero.webm?v=2" });
  expect(parseSource("https://example.com/page.html")).toBeNull();
  expect(parseSource("not a link")).toBeNull();
});

test("fallback links and default ids", () => {
  expect(plainUrl({ provider: "vimeo", id: "9", hash: "abc123" })).toBe("https://player.vimeo.com/video/9?dnt=1&h=abc123");
  expect(plainUrl({ provider: "youtube", id: "dQw4w9WgXcQ" })).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  expect(plainUrl({ provider: "file", id: "/v.mp4" })).toBe("/v.mp4");
  expect(sourceKey({ provider: "vimeo", id: "9" })).toBe("vimeo-9");
  expect(sourceKey({ provider: "file", id: "https://cdn.x/vsl/final-cut.mp4?x=1" })).toBe("file-final-cut");
});

test("the vimeo embed hides Vimeo's chrome, keeps dnt and the unlisted hash, and starts a resume at #t", () => {
  const url = new URL(vimeoEmbedUrl({ provider: "vimeo", id: "9", hash: "abc123" }, { muted: true, startAt: 0 }));
  expect(url.searchParams.get("controls")).toBe("0");
  expect(url.searchParams.get("dnt")).toBe("1");
  expect(url.searchParams.get("muted")).toBe("1");
  expect(url.searchParams.get("autoplay")).toBe("1");
  expect(url.searchParams.get("h")).toBe("abc123");
  expect(url.hash).toBe("");
  expect(new URL(vimeoEmbedUrl({ provider: "vimeo", id: "9" }, { muted: false, startAt: 19.7 })).hash).toBe("#t=19s");
});
