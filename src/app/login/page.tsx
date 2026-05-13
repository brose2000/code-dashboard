import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>code.example.com</CardTitle>
          <CardDescription>Claude Code session manager</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Sign-in failed: <code className="font-mono text-xs">{error}</code>
            </div>
          )}
          <a
            href="/api/auth/signin/google"
            className="block w-full text-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 text-sm font-medium transition-colors"
          >
            Sign in with Google
          </a>
          <p className="text-xs text-muted-foreground">
            Access restricted to authorized accounts.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
