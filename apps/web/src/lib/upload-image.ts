import { apiFetch, readErrorMessage, readJson } from "./api";

export async function uploadImageFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.set("file", file);
  const res = await apiFetch("/uploads/image", { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const body = await readJson<{ url: string }>(res);
  return body.url;
}
