import { dockerAvailable, renderPage } from "./containers.ts";
import { extractText } from "./extract.ts";
import { fetchPublic, htmlToText } from "./fetch.ts";
import { addMaterial, type Material } from "./store.ts";
import { HttpError } from "./util.ts";

/** Fetch a public page or document and keep its text. */
export async function textFromUrl(url: string): Promise<{ title?: string; text: string; finalUrl: string }> {
  const page = await fetchPublic(url);
  const type = page.contentType.toLowerCase();
  if (type.includes("pdf") || page.body.subarray(0, 5).toString() === "%PDF-") {
    return { text: await extractText("page.pdf", page.body), finalUrl: page.url };
  }
  if (type.includes("html") || /^\s*</.test(page.body.subarray(0, 200).toString())) {
    let { title, text }: { title?: string | undefined; text: string } = htmlToText(page.body.toString("utf8"));
    // Pages built by JavaScript arrive nearly empty: render them in headless Chrome in a container.
    if (text.trim().length < 600 && (await dockerAvailable()).ok) {
      const rendered = await renderPage(page.url).then(htmlToText, () => undefined);
      if (rendered && rendered.text.trim().length > text.trim().length) {
        title = rendered.title ?? title;
        text = rendered.text;
      }
    }
    return { ...(title ? { title } : {}), text, finalUrl: page.url };
  }
  const name = new URL(page.url).pathname.split("/").pop() || "page.txt";
  return { text: await extractText(name, page.body), finalUrl: page.url };
}

export async function addUrl(user: string, track: string, url: string, title?: string, note?: string, kind: Material["kind"] = "url"): Promise<Material> {
  const got = await textFromUrl(url);
  if (got.text.trim().length < 40) throw new HttpError(422, "that page has almost no readable text (it may need JavaScript); paste the text instead");
  return addMaterial(user, track, { title: (title || got.title || new URL(got.finalUrl).hostname).slice(0, 160), kind, url: got.finalUrl, note: note ?? "" }, got.text);
}

export async function addUpload(user: string, track: string, name: string, base64: string, note?: string): Promise<Material> {
  const data = Buffer.from(base64, "base64");
  if (!data.length) throw new HttpError(400, "the file is empty");
  if (data.length > 15_000_000) throw new HttpError(413, "files are limited to 15 MB");
  const text = await extractText(name, data);
  if (!text.trim()) throw new HttpError(422, "no text found in that file (a scanned PDF has none)");
  const safeName = name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return addMaterial(user, track, { title: safeName.replace(/\.[^.]+$/, ""), kind: "file", fileName: safeName, note: note ?? "" }, text);
}

export async function addText(user: string, track: string, title: string, text: string, note?: string): Promise<Material> {
  if (!text.trim()) throw new HttpError(400, "paste some text first");
  return addMaterial(user, track, { title: (title || text.trim().split("\n")[0]!).slice(0, 160), kind: "text", note: note ?? "" }, text);
}
