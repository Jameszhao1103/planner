export async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await readJsonPayload(response);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message ?? `Request failed: ${response.status}`);
  }

  return payload?.data;
}

async function readJsonPayload(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    if (!response.ok) {
      return {
        ok: false,
        error: {
          message: `Request failed: ${response.status} ${response.statusText}`.trim(),
        },
      };
    }

    throw error;
  }
}

export function triggerDownload(url) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
