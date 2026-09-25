import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@sqlm/ui';

export default function HomePage() {
  return (
    <main className="container flex flex-col items-center gap-10 py-24 text-center">
      <Badge variant="secondary">Phase 1 — Architecture Foundation</Badge>
      <div className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Digital products, delivered instantly.
        </h1>
        <p className="mx-auto max-w-xl text-muted-foreground">
          AI subscriptions, software licenses, and digital accounts — browse, buy, and get
          delivered through Telegram in minutes.
        </p>
      </div>
      <div className="flex gap-3">
        <Button size="lg">Open Telegram Bot</Button>
        <Button size="lg" variant="outline">
          Browse Catalog
        </Button>
      </div>
      <Card className="w-full max-w-md text-left">
        <CardHeader>
          <CardTitle>Platform status</CardTitle>
          <CardDescription>Core backend, monorepo, and shared UI package are wired up.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Catalog, checkout, and Telegram integration land in the next build phases.
        </CardContent>
      </Card>
    </main>
  );
}
