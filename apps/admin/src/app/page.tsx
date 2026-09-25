import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@sqlm/ui';

const modules = [
  { name: 'Orders', status: 'Phase 5' },
  { name: 'Payment proofs', status: 'Phase 6' },
  { name: 'Inventory', status: 'Phase 4' },
  { name: 'Support', status: 'Phase 10' },
];

export default function AdminHomePage() {
  return (
    <main className="container flex flex-col gap-8 py-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SQLM Admin</h1>
          <p className="text-sm text-muted-foreground">Staff dashboard — scaffold in progress.</p>
        </div>
        <Badge variant="secondary">Phase 1</Badge>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {modules.map((m) => (
          <Card key={m.name}>
            <CardHeader>
              <CardTitle className="text-base">{m.name}</CardTitle>
              <CardDescription>Lands in {m.status}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">Not yet available.</CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
