import { AudioLinesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { login } from "./actions";

export const metadata = { title: "Sign in · STT Playground" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  const failed = params.error === "1";

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AudioLinesIcon className="size-5" /> STT Playground
          </CardTitle>
          <CardDescription>Enter the access password you were given.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={login} className="flex flex-col gap-3">
            <input type="hidden" name="next" value={next} />
            <Label htmlFor="password">Password</Label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {failed && <p className="text-sm text-destructive">That password didn&apos;t work.</p>}
            <Button type="submit" className="mt-1">
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
