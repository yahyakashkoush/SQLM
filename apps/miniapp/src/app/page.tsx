import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@sqlm/ui';

export default function MiniAppHomePage() {
  return (
    <main className="flex min-h-screen flex-col gap-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">SQLM Store</h1>
        <Badge variant="secondary">Phase 1</Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shop opens in Phase 8</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Catalog browsing, cart, and checkout will render here once the backend catalog and
          orders modules ship.
        </CardContent>
      </Card>
      <Button className="w-full" size="lg">
        Continue
      </Button>
    </main>
  );
}
