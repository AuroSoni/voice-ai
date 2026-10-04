export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly provider: string,
  ) {
    super(`${provider} returned ${status}: ${body.slice(0, 300)}`);
  }
}

export async function ensureOk(res: Response, provider: string): Promise<Response> {
  if (res.ok) return res;
  const body = await res.text().catch(() => "");
  throw new UpstreamError(res.status, body, provider);
}
